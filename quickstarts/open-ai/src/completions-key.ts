import { AzureOpenAI } from "openai";
import 'dotenv/config'

// You will need to set these environment variables or edit the following values
const endpoint = process.env.AZURE_OPENAI_ENDPOINT || "<endpoint>";
const apiKey = process.env.AZURE_OPENAI_API_KEY || "<api key>";
if(!endpoint || !apiKey) {
    throw new Error("Please provide an endpoint and API key for connecting to the OpenAI service.");
}

// Azure OpenAI API version 
const apiVersion = "2024-04-01-preview";

// Azure resource deployment name
const deployment = "gpt-35-turbo-instruct"; 

const prompt = ["When was Microsoft founded?"];

async function main() {

  console.log("== Get completions Sample ==");

  const client = new AzureOpenAI({ endpoint, apiKey, apiVersion, deployment });  

  const result = await client.completions.create({ prompt, model: deployment, max_tokens: 128 });

  for (const choice of result.choices) {
    console.log(choice.text);
  }
}

main().catch((err) => {
  console.error("Error occurred:", err);
});

