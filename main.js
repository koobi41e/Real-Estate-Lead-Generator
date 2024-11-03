const { searchInMeckCounty } = require('./searchInMeckCounty');
const {
  subtractMonths,
  formatDate,
  formatTime,
  gatherSalesHistoryAndPhoneNumbers,
  cleanAndMatchPhoneNumbers,
  logAwsMetrics,
  processLead
} = require('./helperFunctions');
require('dotenv').config();
const chromium = require ('@sparticuz/chromium');
const playwright = require('playwright');


exports.handler = async (event) => {
  const executablePath = await chromium.executablePath()
  const browser = await playwright.chromium.launch({executablePath,headless: true, args: chromium.args})
  const page = await browser.newPage();
  
  const meckROD = {};
  const today = new Date();
  const dateThreeMonthsAgo = subtractMonths(new Date(today), 3);
  const fromDate = formatDate(dateThreeMonthsAgo);
  // const dateThreeMonthsAgoPlusOneDay = new Date(dateThreeMonthsAgo);
  // dateThreeMonthsAgoPlusOneDay.setDate(dateThreeMonthsAgoPlusOneDay.getDate() + 1);
  // const toDate = formatDate(dateThreeMonthsAgoPlusOneDay);
  const toDate = fromDate;
  let textMessagesSent = 0;
  let hubSpotContactCount = 0;
  let hubSpotDealCount = 0;
  const startTime = performance.now();

  console.log('Author: Ibook Eyoita');
  console.log('Starting lead generator execution to acquire seller leads from Mecklenburg County.');
  console.log(`Searching for deceased people in register of deeds between ${fromDate} and ${toDate}`);
  
  meckROD.deadPeopleList = event.deadPeopleList;
  meckROD.numberOfNamesExtracted = event.numberOfNamesExtracted;
  
  //Checking Mecklenburg County Property Records
  let meckPropertyDetails = await searchInMeckCounty(page,meckROD.deadPeopleList);
  console.log(`${meckPropertyDetails.length} found in Mecklenburg County from ${meckROD.numberOfNamesExtracted} deceased leads...`);
  console.log(`Acquiring sales history and phone number information of all ${meckPropertyDetails.length} homeowners`);
  meckPropertyDetails = await gatherSalesHistoryAndPhoneNumbers(meckPropertyDetails);
  meckPropertyDetails = cleanAndMatchPhoneNumbers(meckPropertyDetails);

  //text lead then create a HubSpot contact and deal
  for (const lead of meckPropertyDetails){
    const result = await processLead(lead, textMessagesSent, hubSpotContactCount, hubSpotDealCount);
    textMessagesSent = result.textMessagesSent;
    hubSpotContactCount = result.hubSpotContactCount;
    hubSpotDealCount = result.hubSpotDealCount;
  }
  
  await logAwsMetrics(meckPropertyDetails.length,meckROD.numberOfNamesExtracted,textMessagesSent,hubSpotContactCount,hubSpotDealCount);
  const endTime = performance.now();
  const timeElapsed = endTime - startTime;
  console.log('End of lead generator execution');
  console.log(`Names extracted: ${meckROD.numberOfNamesExtracted}\nHomes found: ${meckPropertyDetails.length}\nTexts sent: ${textMessagesSent}\nContacts added to Hubspot: ${hubSpotContactCount}\nDeals added to Hubspot: ${hubSpotDealCount}`);
  console.log(`Time elapsed: ${formatTime(timeElapsed)}`);
  
  await browser.close();
};