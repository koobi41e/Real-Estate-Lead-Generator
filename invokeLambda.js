const {
  getNamesFromMecklenburgRegisterOfDeeds,
  extractDeceasedNamesInMecklenburgROD,
  subtractMonths,
  formatDate,
} = require('./helperFunctions');
const { chromium } = require('playwright');
require('dotenv').config();
const AWS = require('aws-sdk');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  let deadPeopleList = [];
  const today = new Date();
  const dateThreeMonthsAgo = subtractMonths(new Date(today), 3);
  const fromDate = formatDate(dateThreeMonthsAgo);
  const dateThreeMonthsAgoPlusOneDay = new Date(dateThreeMonthsAgo);
  dateThreeMonthsAgoPlusOneDay.setDate(dateThreeMonthsAgoPlusOneDay.getDate() + 1);
  // const toDate = formatDate(dateThreeMonthsAgoPlusOneDay);
  const toDate = fromDate;
  let pageNumber = 1;

  AWS.config.update({ region: process.env.AWS_REGION });
  const lambda = new AWS.Lambda();

  console.log('Author: Ibook Eyoita');
  console.log('Starting lead generator execution to acquire seller leads from Mecklenburg County.');
  console.log(`Searching for deceased people in register of deeds between ${fromDate} and ${toDate}`);

  try {
    await getNamesFromMecklenburgRegisterOfDeeds(page, fromDate, toDate);
    const meckROD = await extractDeceasedNamesInMecklenburgROD(page, deadPeopleList, pageNumber);

    const invokeLambdaAsync = async () => {
      // Define the parameters for the Lambda invocation
      const params = {
        FunctionName: 're-lead-gen-process',
        InvocationType: 'Event', // 'Event' for async invocation
        LogType: 'Tail',
        Payload: JSON.stringify(meckROD) // Replace with your function's input payload
      };

      try {
        const data = await lambda.invoke(params).promise();
        console.log('Lambda function invoked successfully.');
      } catch (err) {
        console.error('Error invoking Lambda function:', err);
      }
    };

    await invokeLambdaAsync();
  } catch (error) {
    console.error('Error during execution:', error);
  } finally {
    await browser.close(); // Ensure the browser is closed
    console.log('Browser closed. Script execution finished.');
  }
})();
