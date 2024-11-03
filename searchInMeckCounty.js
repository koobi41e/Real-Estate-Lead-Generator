const { Page } = require('playwright');

async function processOwner(page, owner,flag) {
  const formatName = (name) => {
    const substrings = name.split(/\s+/);
    let result;

    if (substrings.length === 2) {
      result = substrings.join(' ');
    } else if (substrings.length === 3 || substrings.length > 3) {
      result = `${substrings[0]} ${substrings[1]} ${substrings[2].charAt(0)}`;
    }

    return result;
  };

  const formattedName = formatName(owner.person);
  let slicedName = '';
  if(flag === true){
    //search with Middle Initial
    slicedName = formattedName?.split(/\s+/);
    console.log(`...searching mecklenburg properties owned by ${formattedName}`);
  }else{
    //search with whole name
    slicedName = owner.person?.split(/\s+/);
    console.log(`...searching mecklenburg properties owned by ${owner.person}`);
  }
  

  if (slicedName?.length === 2) {
    await page.goto(`https://property.spatialest.com/nc/mecklenburg/#/search?category=Owner1&term=${slicedName[0]}%20${slicedName[1]}`);
  } else if (slicedName?.length === 3) {
    await page.goto(`https://property.spatialest.com/nc/mecklenburg/#/search?category=Owner1&term=${slicedName[0]}%20${slicedName[1]}%20${slicedName[2]}`);
  }
  await page.waitForTimeout(5000);

  try {
    const isSinglePage = await page.waitForSelector('.collapsible-section', { state: 'attached', timeout: 2000 });
    const results = await page.evaluate(() => {
      const nameElement = document.querySelector('div.mailing > div.value');
      const addressElement = document.querySelector('div.location.text-highlight > span.value');
      const appraisedValueElement = document.querySelector('div.sticky-container > header > div > div > div:nth-child(3) > div > div.text-highlight > span');

      let homeOwnersName = nameElement ? nameElement.innerText.trim() : null;
      const address = addressElement ? addressElement.innerText.trim() : null;
      const appraised_value = appraisedValueElement ? appraisedValueElement.innerText.trim() : null;
      const index = homeOwnersName.indexOf('\n');
      homeOwnersName = homeOwnersName.substring(0, index);

      const rawMailingAddressDOM = document.querySelector('header > div > div > div:nth-child(2) > div > div');
      const rawMailingAddressDOMContent = rawMailingAddressDOM?.innerHTML.replace(/<br\s*\/?>/gi, '\n');
      const firstIntegerIndex = rawMailingAddressDOMContent?.search(/\d/);
      const mailingAddress = rawMailingAddressDOMContent?.substring(firstIntegerIndex).replace(/\n/g, ', ');

      return { homeOwnersName, address, appraised_value, mailingAddress };
    });
    return [{ ...owner, ...results }];
  } catch (error) {
    const results = await page.locator('.result-item-wrapper').evaluateAll((propertyList, { formattedName, slicedName, owner }) => {
      const ownedProperty = [];

      propertyList.forEach(property => {
        if (slicedName.length === 3) {
          const ownersElement = property.querySelector('li:nth-child(2) .value');
          const addressElement = property.querySelector('p:nth-child(2) > span.value');
          const appraisedValueElement = property.querySelector('div.featured > div.featured-item.item-2 > p:nth-child(2) > span');
          const propertyId = property.getAttribute('data-id');
          if (ownersElement && ownersElement.textContent?.toLowerCase().includes(formattedName.toLowerCase())) {
            ownedProperty.push({
              homeOwnersName: ownersElement.textContent.trim(),
              address: addressElement.textContent.trim(),
              appraised_value: appraisedValueElement.textContent.trim(),
              person: owner.person,
              deathDate: owner.deathDate,
              sex: owner.sex,
              propertyId
            });
          }
        } else if (slicedName.length === 2 && property.querySelector('li:nth-child(2) .value').textContent.toLowerCase().trim().split(',')[0] === formattedName.toLowerCase()) {
          const ownersElement = property.querySelector('li:nth-child(2) .value');
          const addressElement = property.querySelector('p:nth-child(2) > span.value');
          const appraisedValueElement = property.querySelector('div.featured > div.featured-item.item-2 > p:nth-child(2) > span');
          const propertyId = property.getAttribute('data-id');
          ownedProperty.push({
            homeOwnersName: ownersElement.textContent.trim(),
            address: addressElement.textContent.trim(),
            appraised_value: appraisedValueElement.textContent.trim(),
            person: owner.person,
            deathDate: owner.deathDate,
            sex: owner.sex,
            propertyId
          });
        }
      });
      return ownedProperty;
    }, { formattedName, slicedName, owner });

    if (results.length > 0) {
      for (let result of results) {
        await page.goto(`https://property.spatialest.com/nc/mecklenburg/#/property/${result.propertyId}`);
        await page.waitForTimeout(5000);
        const mailingAddress = await page.evaluate(() => {
          const rawMailingAddressDOM = document.querySelector('header > div > div > div:nth-child(2) > div > div');
          const rawMailingAddressDOMContent = rawMailingAddressDOM?.innerHTML.replace(/<br\s*\/?>/gi, '\n');
          const firstIntegerIndex = rawMailingAddressDOMContent?.search(/\d/);
          const mailingAddress = rawMailingAddressDOMContent?.substring(firstIntegerIndex).replace(/\n/g, ', ');
          return mailingAddress;
        });
        result.mailingAddress = mailingAddress;
      }
    }
    return results;
  }
}

async function searchInMeckCounty(page, deadPeopleList) {
  const homeOwnerInformation = [];

  console.log('Beginning to cross-search properties based on deceased names.');
  for (const ownerList of deadPeopleList) {
    for (let owner of ownerList) {
      if (owner.person === '') {
        continue;
      }

      const results = await processOwner(page, owner,false);
      let results2 = [];
      if(owner.person.split(' ').length > 2){
        results2 = await processOwner(page, owner,true);
      }
      if (results.length > 0) {
        homeOwnerInformation.push(...results);
      }
      if (results2.length > 0 && owner.person.split(' ').length > 2) {
        homeOwnerInformation.push(...results2);
      }
    }
  }
  console.log(`${homeOwnerInformation.length} properties found within Mecklenburg county.`);
  console.log('Ended cross-search properties based on deceased names.');

  return homeOwnerInformation;
}


module.exports = {
  searchInMeckCounty
}