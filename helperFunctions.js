const { Page } = require('playwright');
const axios = require('axios');
const qs = require('qs');
const aws = require('aws-sdk');

//creates a delay in the runtime async code. 
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Converts camelCase to Snake_Case and capitalizes each word
const formatKey = (str) => {
    return str
        .replace(/([a-z])([A-Z])/g, '$1_$2') // Convert camel case to snake case
        .split('_')                          // Split into words
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()) // Capitalize each word
        .join('_');                          // Join words with an underscore
};

// Checks if an element with the given selector has the 'disabled' attribute
const isNextDisabled = async (page) => {
    return await page.$eval('#OptionsBar2_imgNext', (el) => el.hasAttribute('disabled'));
};

// Subtracts a given number of months from a date
const subtractMonths = (date, months) => {
    date.setMonth(date.getMonth() - months);
    return date;
};

// Formats a date object into mm/dd/yyyy
const formatDate = (date) => {
    const mm = String(date.getMonth() + 1).padStart(2, '0'); // Months are zero-based
    const dd = String(date.getDate()).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
};

// Calls the Skip Engine API
const callSkipEngine = async (payload) => {
    const url = 'https://api.skipengine.com/v1/service';
    const apiKey = process.env.SKIPENGINE_API_KEY;
    const headers = {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
    };

    try {
        const response = await axios.post(url, payload, { headers });
        return response.data.Output;
    } catch (error) {
        console.error(`Error calling skip engine`, error);
    }
};

// Calls the Endato API
const callEndatoAPI = async (payload) => {
    const url = 'https://devapi.endato.com/Contact/Enrich';
    const headers = {
        'accept': 'application/json',
        'content-type': 'application/json',
        'galaxy-ap-name': process.env.ENDATO_AP_NAME,
        'galaxy-ap-password': process.env.ENDATO_AP_PASSWORD,
        'galaxy-search-type': 'DevAPIContactEnrich',
    };

    try {
        const response = await axios.post(url, payload, { headers });
        if (response.data?.message?.trim() === "No strong matches") {
            console.log(`...endato API can not find any results for address: ${payload.Address.addressLine1}, ${payload.Address.addressLine2}`);
        }
        return response.data.person;
    } catch (error) {
        console.error(`Error calling Endato API`, error);
    }
};

const parseAddress = (addressString) => {
    const addressPattern = /^(.*?),\s*(.*?),\s*(.*)\s*(\d{5}),\s*(.*)$/;
    const match = addressPattern.exec(addressString);
    
    if (!match) {
        return null;
    }
  
    const [, address, city, state, zip, country] = match;
  
    return {
      address,
      city,
      state,
      zip
    };
};

const getAddressFromGoogle = async (address) => {
    const url = 'https://maps.googleapis.com/maps/api/geocode/json';
    const params = {
      address,
      key: process.env.GOOGLE_API_KEY
    };

    try {
      const response = await axios.get(url, { params });
      if (response.data.results.length === 0) {
        return null;
      }
      const googleAddress = response.data.results[0].formatted_address;
      return googleAddress;
    } catch (error) {
      console.error(`Error getting address from Google for address ${address}:`, error);
      return null;     
    }
};

const formatTime = (ms) => {
    const minutes = Math.floor(ms / 60000);
    const seconds = ((ms % 60000) / 1000).toFixed(0);
    return `${minutes} minutes and ${seconds < 10 ? '0' : ''}${seconds} seconds`;
};

// Gathers sales history and phone numbers for home owner information
const gatherSalesHistoryAndPhoneNumbers = async (homeOwnerInformation) => {
    const promises = homeOwnerInformation.map(async (lead) => {
        const namesList = lead.person.split(' ');
        if (namesList.length < 2) {
            console.error(`Invalid name format for lead: ${lead.person}`);
            lead.skipEnginePhoneNumbers = null;
            lead.MortgageAmount = '';
            lead.Equity = '';
            lead.loanToValue = '';
            lead.age = '';
            lead.endatoPhoneNumbers = null;
            lead.googleAddress = '';
            return lead;
        }

        const numOfHomeOwners = lead.homeOwnersName.split(',').length;
        if (numOfHomeOwners === 1) {
            console.error(`Skipping lead: ${lead.person} does not have a spouse.`);
            lead.skipEnginePhoneNumbers = null;
            lead.MortgageAmount = '';
            lead.Equity = '';
            lead.loanToValue = '';
            lead.age = '';
            lead.endatoPhoneNumbers = null;
            lead.googleAddress = '';
            lead.spouse = '';
            return lead;
        }

        const googleAddress = await getAddressFromGoogle(lead.address);
        if (!googleAddress || googleAddress === null) {
            console.error(`Skipping lead, ${lead.person}, at address, ${lead.address}, due to google address lookup failure.`);
            lead.skipEnginePhoneNumbers = null;
            lead.MortgageAmount = '';
            lead.Equity = '';
            lead.loanToValue = '';
            lead.age = '';
            lead.endatoPhoneNumbers = null;
            lead.googleAddress = '';
            return lead;
        }

        const parsedAddress = parseAddress(googleAddress);
        if (parsedAddress === null){
            console.error(`Can not parse Google address, ${googleAddress}, for ${lead.person}.`);
            lead.skipEnginePhoneNumbers = null;
            lead.MortgageAmount = '';
            lead.Equity = '';
            lead.loanToValue = '';
            lead.age = '';
            lead.endatoPhoneNumbers = null;
            lead.googleAddress = '';
            return lead;
        }
        const spouse = lead.homeOwnersName.split(',').find(name => !lead.person.includes(name.trim()));
        lead.spouse = spouse.split(" ")[1].trim() + " " + spouse.split(" ")[0].trim();      
        lead.googleAddress = googleAddress;
        const skipEnginePayload = {
            "FName": namesList[1].trim(),
            "LName": namesList[0].trim(),
            "Address1": parsedAddress.address,
            "City": parsedAddress.city.trim(),
            "State": parsedAddress.state.trim(),
            "Zip": parsedAddress.zip.trim()
        };

        const endatoPayload = {
            "FirstName": namesList[1].trim(),
            "LastName": namesList[0].trim(),
            "Age": 0,
            "Dob": "",
            "Address": {
                "addressLine1": parsedAddress.address,
                "addressLine2": `${parsedAddress.city.trim()}, ${parsedAddress.state.trim()}`
            },
            "Phone": "",
            "Email": ""
        };

        const skipEngineResults = await callSkipEngine(skipEnginePayload);
        const endatoResults = await callEndatoAPI(endatoPayload);

        lead.skipEnginePhoneNumbers = skipEngineResults?.Identity?.Phones || null;
        lead.deedDetails = {
            "MortgageAmount": skipEngineResults?.Property?.CurrentDeed?.MortgageAmount || '',
            "Equity": skipEngineResults?.Property?.CurrentDeed?.EquityPercentage || '',
            "loanToValue": skipEngineResults?.Property?.CurrentDeed?.LoanToValue || ''
        };

        lead.taxDelinquentYear = skipEngineResults?.Property?.Tax?.TaxDelinquentYear || '';
        lead.yearBuilt = skipEngineResults?.Property?.PropertyUseInfo?.YearBuilt || '';
        lead.distressedDetails = {
            "Foreclosure": skipEngineResults?.Property?.PropertyDetails?.Foreclosure || '',
            "PreForeclosure": skipEngineResults?.Property?.PropertyDetails?.PreForeclosure || '',
            "BankOwned": skipEngineResults?.Property?.PropertyDetails?.BankOwned || '',
            "Auction": skipEngineResults?.Property?.PropertyDetails?.Auction || '',
            "Vacant": skipEngineResults?.Property?.PropertyDetails?.Foreclosure?.Vacant || '',
            "Absentee": skipEngineResults?.Property?.PropertyDetails?.Foreclosure?.Absentee || ''
        };
        lead.salesInfo = {
            "priorSaleAmount": skipEngineResults?.Property?.SaleInfo?.AssessorPriorSaleAmount || '',
            "priorSaleDate": skipEngineResults?.Property?.SaleInfo?.AssessorPriorSaleDate || '',
            "sellerPurchaseDate": skipEngineResults?.Property?.SaleInfo?.AssessorLastSaleDate || '',
            "sellerPurchaseAmount": skipEngineResults?.Property?.SaleInfo?.AssessorLastSaleAmount || ''
        };
        lead.propertySpecs = {
            "livingSqFt": skipEngineResults?.Property?.PropertySize?.LivingSqFt || '',
            "basementArea": skipEngineResults?.Property?.PropertySize?.BasementArea || '',
            "Garage": skipEngineResults?.Property?.PropertySize?.ParkingGarage || '',
            "Pool": skipEngineResults?.Property?.Pool?.Pool || '',
            "lotAcres": skipEngineResults?.Property?.PropertySize?.AreaLotAcres || '',
            "fullBaths": skipEngineResults?.Property?.IntRoomInfo?.BathCount || '',
            "halfBaths": skipEngineResults?.Property?.IntRoomInfo?.BathPartialCount || '',
            "bedrooms": skipEngineResults?.Property?.IntRoomInfo?.BedroomsCount || '',
            "stories": skipEngineResults?.Property?.IntRoomInfo?.StoriesCount || ''
        };
        lead.estimatedValue = skipEngineResults?.Property?.EstimatedValue?.EstimatedValue || '';

        if (endatoResults !== undefined) {
            lead.endatoPhoneNumbers = endatoResults.phones;
            lead.age = endatoResults.age;
        } else {
            lead.age = '';
            lead.endatoPhoneNumbers = null;
        }
        return lead;

    });

    const results = await Promise.all(promises);
    // Filter out any null values that were returned due to invalid leads or failed lookups
    return results.filter(lead => lead !== null);
};

// Cleans and matches phone numbers from different sources
const cleanAndMatchPhoneNumbers = (homeOwnerInformation) => {
    const cleanPhoneNumber = (phoneNumber) => {
        return phoneNumber.replace(/\D/g, '');
    };

    const processEntry = (entry) => {
        if (entry.endatoPhoneNumbers === null && entry.skipEnginePhoneNumbers === null) {
            console.error(`Cannot clean phone numbers for homeowner, ${entry.person}. There is no data to process.`);
            return entry;
        } else {
            const skipEngineNumbers = [
                entry.skipEnginePhoneNumbers.Phone?.Phone || '',
                entry.skipEnginePhoneNumbers.Phone2?.Phone || '',
                entry.skipEnginePhoneNumbers.Phone3?.Phone || '',
                entry.skipEnginePhoneNumbers.Phone4?.Phone || '',
                entry.skipEnginePhoneNumbers.Phone5?.Phone || ''
            ].map(cleanPhoneNumber);

            let cleanNumbers = [];

            if (entry.endatoPhoneNumbers !== null) {
                entry.endatoPhoneNumbers.forEach((phone) => {
                    const cleanedNumber = cleanPhoneNumber(phone.number);
                    if (skipEngineNumbers.includes(cleanedNumber)) {
                        cleanNumbers.push(cleanedNumber);
                        entry.phoneNumberConfidence = 'High';
                    }
                });
                if (cleanNumbers.length === 0) {
                    console.error(`Cannot find a phone number match between skipEngine and Endato for ${entry.person}. Assigning any first two numbers from skip engine.`);
                    skipEngineNumbers[0] !== '' ? cleanNumbers.push(skipEngineNumbers[0]) : null;
                    skipEngineNumbers[1] !== '' ? cleanNumbers.push(skipEngineNumbers[1]) : null;
                    entry.phoneNumberConfidence = 'Medium';
                }
                entry.cleanedNumbers = cleanNumbers;
                return entry;
            } else {
                console.error(`Cannot clean number for ${entry.person}. Assigning any first two numbers from skip engine.`);
                skipEngineNumbers[0] !== '' ? cleanNumbers.push(skipEngineNumbers[0]) : null;
                skipEngineNumbers[1] !== '' ? cleanNumbers.push(skipEngineNumbers[1]) : null;
                entry.cleanedNumbers = cleanNumbers;
                entry.phoneNumberConfidence = 'Medium';
                return entry;
            }
        }
    };

    if (Array.isArray(homeOwnerInformation)) {
        return homeOwnerInformation.map(processEntry);
    } else {
        return processEntry(homeOwnerInformation);
    }
};

// Creates a HubSpot contact
const createHubspotContact = async (name, payload) => {
    const url = 'https://api.hubapi.com/crm/v3/objects/contacts';
    const apiToken = process.env.HUBSPOT_API_KEY;

    const options = {
        headers: {
            'Authorization': `Bearer ${apiToken}`,
            'Content-Type': 'application/json'
        }
    };

    try {
        const response = await axios.post(url, payload, options);
        console.log(`HubSpot contact created successfully for ${name}`);
        return response.data.id;
    } catch (error) {
        console.error(`Error creating HubSpot contact ${name}:`, error.response ? error.response.data : error.message);
    }
};

// Creates a HubSpot deal
const createHubspotDeal = async (name, payload, hubspotContactId) => {
    const url = 'https://api.hubapi.com/crm/v3/objects/deals';
    const apiToken = process.env.HUBSPOT_API_KEY;

    const options = {
        headers: {
            'Authorization': `Bearer ${apiToken}`,
            'Content-Type': 'application/json'
        }
    };

    try {
        const response = await axios.post(url, payload, options);
        console.log(`HubSpot deal created successfully for ${name}`);
    } catch (error) {
        console.error(`Error creating HubSpot deal for ${name}:`, error.response ? error.response.data : error.message);
    }
};

// Sends a message to the seller
const sendMessageToSeller = async (phoneNumbers, name, counter) => {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_TOKEN;
    const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const parsedName = name.split(' ')[1];
    const message = 
    `I am deeply sorry to hear about the loss of ${parsedName.charAt(0) + parsedName.slice(1).toLowerCase()}. My heart goes out to you during this difficult time. I can't imagine what you're going through right now. In moments like these, managing practical matters can feel overwhelming. As a realtor with Fathom Realty, I want to extend my support. If you are considering selling your property, I am here to help in any way I can. Please don’t hesitate to reach out. I’m here for you.\n\nWith Heartfelt Sympathy,\nIbook Eyoita`;

    const sendToNumber = async (to)=> {
        const data = qs.stringify({
            'To': `+1${to}`,
            'MessagingServiceSid': messagingServiceSid,
            'Body': message
        });

        const config = {
            method: 'post',
            url: url,
            auth: {
                username: accountSid,
                password: authToken
            },
            headers: { 
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            data: data
        };

        try {
            const response = await axios(config);
            console.log(`Message sent successfully for lead ${name}`);
            return true;
        } catch (error) {
            console.error(`Error sending message for phone number ${to} for lead ${name}:`, error.response ? error.response.data : error.message);
            return false;
        }
    };

    let atLeastOneSuccess = false;
    await Promise.all(
        phoneNumbers.map(async (number) => {
            const success = await sendToNumber(number);
            if (success) {
                atLeastOneSuccess = true;
                counter++;
            }
        })
    );

    return { atLeastOneSuccess, counter };
};

// Performs a search query on Mecklenburg Register of Deeds
const getNamesFromMecklenburgRegisterOfDeeds = async (page, fromDate, toDate) => {
    // Go to the website
    await page.goto('https://meckrod.manatron.com/');

    // Click on the necessary links and buttons
    await page.getByRole('link', { name: 'Click here to acknowledge the' }).click();
    await page.getByRole('link', { name: 'Death' }).click();
    await page.getByRole('link', { name: 'Search Death Index' }).click();

    // Fill in the date fields
    await page.locator('#cphNoMargin_f_ddcDateOfDeathFrom').getByRole('textbox', { name: 'mm/dd/yyyy' }).fill(fromDate);
    await page.locator('#cphNoMargin_f_ddcDateOfDeathTo').getByRole('textbox', { name: 'mm/dd/yyyy' }).fill(toDate);

    // Click the search button and wait for results
    await page.locator('#cphNoMargin_SearchButtons2_btnSearch__5').click();
    await page.waitForTimeout(5000);
};

  // Extracts every name from every page from search results in Register of Deeds
  const extractDeceasedNamesInMecklenburgROD = async (page,deadPeopleList,pageNumber) => {

    const extractRows = async () => {
      return await page.locator('tbody[mkr="rows"] > tr').evaluateAll((trs) => {
        return trs.map(tr => {
          const tds = tr.querySelectorAll('td');
          const rowInfo = { person: "", deathDate: "", sex: "" };
          tds.forEach(td => {
            const text = td.textContent.trim();
  
            if (/[a-zA-Z]/.test(text) && (text.split(' ').length - 1) >= 1) {
              // found a name
              rowInfo.person = text;
            }
  
            if (/\b\d{2}\/\d{2}\/\d{4}\b/.test(text)) {
              // found death date
              rowInfo.deathDate = text;
            }
  
            if (text.length === 1 && (text === 'F' || text === 'M')) {
              // found sex
              rowInfo.sex = text;
            }
          });
          return rowInfo;
        });
      });
    };
  
    while (true) {
      const disabled = await isNextDisabled(page);
      if (disabled) {
        console.log(`Last page reached, page ${pageNumber}, and exiting loop.`);
        const rows = await extractRows();
        deadPeopleList.push(rows);
        break;
      }
  
      console.log(`Extracting deceased names from page ${pageNumber}`);
      const rows = await extractRows();
      deadPeopleList.push(rows);
      await page.locator('#OptionsBar2_imgNext').click();
      await page.waitForTimeout(3000); // Wait for 3 seconds before next iteration
      pageNumber++;
    }
  
    const pageCounts = deadPeopleList.map(childArray => childArray.length);
    const rowsCounted = pageCounts.reduce((sum, value) => sum + value, 0);
    const numberOfNamesExtracted = rowsCounted - deadPeopleList.length;
    console.log(`${numberOfNamesExtracted} deceased names extracted. Starting cross-search on properties based on deceased name in Mecklenburg County.`);
  
    return { deadPeopleList, numberOfNamesExtracted };
  };

  const searchContact = async (firstName, lastName) => {
    const url = 'https://api.hubapi.com/crm/v3/objects/contacts/search';
    const hubspotApiKey = process.env.HUBSPOT_API_KEY;
    const payload = {
        "filterGroups": [{
            "filters": [
                {
                    "propertyName": "firstname",
                    "operator": "EQ",
                    "value": firstName
                },
                {
                    "propertyName": "lastname",
                    "operator": "EQ",
                    "value": lastName
                }
            ]
        }]
    };

    const options = {
        headers: {
            'Authorization': `Bearer ${hubspotApiKey}`,
            'Content-Type': 'application/json'
        }
    };

    try {
        const response = await axios.post(url, payload, options);
        if (response.data.results.length > 0) {
            console.log(`Existing Hubspot contact found for ${firstName} ${lastName}. Ignoring Hubspot create contact request.`);
            return response.data.results[0].id;
        } else {
            return null;        
        }
    } catch (error) {
        console.error('Error searching for contact:', error.response ? error.response.data : error.message);
    }
};

const logAwsMetrics = async (homesFound, leadsExtracted, textsSent, contactsCreated, dealsCreated) => {
    const cloudwatch = new aws.CloudWatch({
        region: 'us-east-2',
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_ACCESS_SECRET_KEY
    }); 

    const createMetricDataParams = (metricName, value) => ({
        MetricData: [
            {
                MetricName: metricName,
                Dimensions: [
                    {
                        Name: 'Production',
                        Value: process.env.AWS_LAMBDA_FUNCTION_NAME
                    }
                ],
                Unit: 'Count',
                Value: value
            }
        ],
        Namespace: 're-lead-gen' // Define your custom namespace
    });

    const homeFoundParams = createMetricDataParams('HomesFound', homesFound);
    const leadsExtractedParams = createMetricDataParams('leadsExtracted', leadsExtracted);
    const textsSentParams = createMetricDataParams('TextsSent', textsSent);
    const contactsCreatedParams = createMetricDataParams('HubspotContactsCreated', contactsCreated);
    const dealsCreatedParams = createMetricDataParams('HubspotDealsCreated', dealsCreated);

    try {
        await cloudwatch.putMetricData(homeFoundParams).promise();
        await cloudwatch.putMetricData(leadsExtractedParams).promise();
        await cloudwatch.putMetricData(textsSentParams).promise();
        await cloudwatch.putMetricData(contactsCreatedParams).promise();
        await cloudwatch.putMetricData(dealsCreatedParams).promise();
        console.log('Successfully stored AWS metrics');
    } catch (error) {
        console.error('Error storing AWS metrics:', error.response ? error.response.data : error.message);
    }
};

const processLead = async (lead, textMessagesSent, hubSpotContactCount, hubSpotDealCount) => {
    if (lead.spouse && lead.googleAddress && lead.cleanedNumbers) {
        await delay(3000); // Wait for 3 seconds
        let hubspotContactId = await searchContact(lead.person.split(" ")[1], lead.person.split(" ")[0]);
        
        if(hubspotContactId === null)
        {   
            console.log(`Texting all phone numbers belonging to ${lead.person}`);
            const obj = await sendMessageToSeller(lead.cleanedNumbers, lead.person, textMessagesSent);
            const messagesDelivered = obj.atLeastOneSuccess;
            textMessagesSent = obj.counter;
        }

        // Send lead to HubSpot
        if (hubspotContactId === null) {
            const hubspotContactPayload = {
                properties: {
                    address: lead.mailingAddress.split(',')[0].trim(),
                    age: lead.age.trim(),
                    city: lead.mailingAddress.split(',')[1].trim().split(' ')[0].trim(),
                    death_date: lead.deathDate.trim(),
                    email: "",
                    firstname: lead.person.split(' ')[1].trim().charAt(0) + lead.person.split(' ')[1].trim().slice(1).toLowerCase(),
                    gender: lead.sex.trim(),
                    hs_lead_status: "ATTEMPTED_TO_CONTACT",
                    hs_object_id: "36420085090",
                    hubspot_owner_id: "923414170",
                    lastname: lead.person.split(' ')[0].trim().charAt(0) + lead.person.split(' ')[0].trim().slice(1).toLowerCase(),
                    phone: lead?.cleanedNumbers?.length >= 1 ? '+1' + lead.cleanedNumbers[0] : '',
                    phone_number_2: lead?.cleanedNumbers?.length > 1 ? '+1' + lead.cleanedNumbers[1] : '',
                    phone_number_3: (lead?.cleanedNumbers?.length > 2 && lead.cleanedNumbers[2] !== null) ? '+1' + lead.cleanedNumbers[2] : '',
                    phone_number_4: (lead?.cleanedNumbers?.length > 3 && lead.cleanedNumbers[3] !== null) ? '+1' + lead.cleanedNumbers[3] : '',
                    phone_number_confidence: lead.phoneNumberConfidence,
                    sales_contact_type: "SELLER",
                    spouse_name: lead.spouse,
                    state: lead.mailingAddress.split(',')[1].trim().split(' ')[1].trim(),
                    zip: lead.mailingAddress.split(',')[1].trim().split(' ')[2].trim(),
                    texts_attempts_made_to_contact: "1" // if successfully texts the contact
                }
            };
            hubspotContactId = await createHubspotContact(lead.person, hubspotContactPayload);
            hubSpotContactCount++;
            const hubspotDealPayload = {
                associations: [
                    {
                        types: [
                            {
                                associationCategory: "HUBSPOT_DEFINED",
                                associationTypeId: 3
                            }
                        ],
                        to: {
                            id: hubspotContactId
                        }
                    }
                ],
                properties: {
                    address: lead.googleAddress,
                    amount: lead.estimatedValue,
                    appraised_value: lead.appraised_value.split('$').join('').split(',').join('').trim(),
                    bedrooms: lead.propertySpecs.bedrooms.charAt(0),
                    dealname: lead.googleAddress.split(',')[0].trim(),
                    dealstage: "206587575",
                    dealtype: "newListing",
                    distress_details: Object.entries(lead.distressedDetails).filter(([key, value]) => value === 'Y').map(([key]) => formatKey(key)).join(';'),
                    equity: lead.deedDetails.Equity.trim(),
                    full_baths: lead.propertySpecs.fullBaths.charAt(0),
                    garage: lead.propertySpecs.Garage === 'Y' ? 'true' : 'false',
                    half_baths: lead.propertySpecs.halfBaths.charAt(0),
                    hs_object_id: "20552738073",
                    hs_priority: "low",
                    hubspot_owner_id: "923414170",
                    living_sq_ft: lead.propertySpecs.livingSqFt,
                    lot_acres: parseFloat(lead.propertySpecs.lotAcres).toFixed(2),
                    ltv: lead.deedDetails.loanToValue.toString(),
                    mortgage_amount: lead.deedDetails.MortgageAmount,
                    pipeline: "116198683",
                    pool: lead.propertySpecs.Pool === 'Y' ? 'true' : 'false',
                    prior_sale_amount: lead.salesInfo.priorSaleAmount.trim(),
                    prior_sale_date: lead.salesInfo.priorSaleDate.split('T')[0].trim(),
                    seller_purchase_amount: lead.salesInfo.sellerPurchaseAmount.trim(),
                    seller_purchase_date: lead.salesInfo.sellerPurchaseDate.split('T')[0].trim(),
                    stories: lead.propertySpecs.stories,
                    tax_delinquent_year: lead.taxDelinquentYear,
                    year_built: lead.yearBuilt
                }
            };
            await createHubspotDeal(lead.person, hubspotDealPayload, hubspotContactId);
            hubSpotDealCount++;
        } else {
            const hubspotDealPayload = {
                associations: [
                    {
                        types: [
                            {
                                associationCategory: "HUBSPOT_DEFINED",
                                associationTypeId: 3
                            }
                        ],
                        to: {
                            id: hubspotContactId
                        }
                    }
                ],
                properties: {
                    address: lead.googleAddress,
                    amount: lead.estimatedValue,
                    appraised_value: lead.appraised_value.split('$').join('').split(',').join('').trim(),
                    bedrooms: lead.propertySpecs.bedrooms.charAt(0),
                    dealname: lead.googleAddress.split(',')[0].trim(),
                    dealstage: "206587575",
                    dealtype: "newListing",
                    distress_details: Object.entries(lead.distressedDetails).filter(([key, value]) => value === 'Y').map(([key]) => formatKey(key)).join(';'),
                    equity: lead.deedDetails.Equity.trim(),
                    full_baths: lead.propertySpecs.fullBaths.charAt(0),
                    garage: lead.propertySpecs.Garage === 'Y' ? 'true' : 'false',
                    half_baths: lead.propertySpecs.halfBaths.charAt(0),
                    hs_object_id: "20552738073",
                    hs_priority: "low",
                    hubspot_owner_id: "923414170",
                    living_sq_ft: lead.propertySpecs.livingSqFt,
                    lot_acres: parseFloat(lead.propertySpecs.lotAcres).toFixed(2),
                    ltv: lead.deedDetails.loanToValue.toString(),
                    mortgage_amount: lead.deedDetails.MortgageAmount,
                    pipeline: "116198683",
                    pool: lead.propertySpecs.Pool === 'Y' ? 'true' : 'false',
                    prior_sale_amount: lead.salesInfo.priorSaleAmount.trim(),
                    prior_sale_date: lead.salesInfo.priorSaleDate.split('T')[0].trim(),
                    seller_purchase_amount: lead.salesInfo.sellerPurchaseAmount.trim(),
                    seller_purchase_date: lead.salesInfo.sellerPurchaseDate.split('T')[0].trim(),
                    stories: lead.propertySpecs.stories,
                    tax_delinquent_year: lead.taxDelinquentYear,
                    year_built: lead.yearBuilt
                }
            };
            await createHubspotDeal(lead.person, hubspotDealPayload, hubspotContactId);
            hubSpotDealCount++;
        }
    
    }
    return { textMessagesSent, hubSpotContactCount, hubSpotDealCount };
};



  module.exports = {
    getNamesFromMecklenburgRegisterOfDeeds,
    extractDeceasedNamesInMecklenburgROD,
    formatKey,
    isNextDisabled,
    subtractMonths,
    formatDate,
    callSkipEngine,
    callEndatoAPI,
    parseAddress,
    getAddressFromGoogle,
    formatTime,
    gatherSalesHistoryAndPhoneNumbers,
    cleanAndMatchPhoneNumbers,
    createHubspotContact,
    createHubspotDeal,
    sendMessageToSeller,
    searchContact,
    logAwsMetrics,
    processLead
  };