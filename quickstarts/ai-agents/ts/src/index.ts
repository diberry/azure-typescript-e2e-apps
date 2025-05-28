// index.ts
import {
  RunStreamEvent,
  MessageStreamEvent,
  DoneEvent,
  ErrorEvent,
  AgentsClient,
  isOutputOfType,
  ToolUtility,
} from "@azure/ai-agents";
import { DefaultAzureCredential } from "@azure/identity";

import * as fs from "fs";
import * as path from "node:path";
import "dotenv/config";

const projectEndpoint = process.env["PROJECT_ENDPOINT"]!;
const modelDeploymentName = process.env["MODEL_DEPLOYMENT_NAME"]! || "gpt-4o";

async function main() {
  // Create an Azure AI Client
  const client = new AgentsClient(projectEndpoint, new DefaultAzureCredential());

  // Upload file and wait for it to be processed
  const filePath = "./data/nifty500QuarterlyResults.csv";
  const localFileStream = fs.createReadStream(filePath);
  const localFile = await client.files.upload(localFileStream, "assistants", {
    fileName: "myLocalFile",
  });

  console.log(`Uploaded local file, file ID : ${localFile.id}`);

  // Create code interpreter tool
  const codeInterpreterTool = ToolUtility.createCodeInterpreterTool([localFile.id]);

  // Notice that CodeInterpreter must be enabled in the agent creation, otherwise the agent will not be able to see the file attachment
  const agent = await client.createAgent(modelDeploymentName, {
    name: "my-agent",
    instructions: "You are a helpful agent",
    tools: [codeInterpreterTool.definition],
    toolResources: codeInterpreterTool.resources,
  });
  console.log(`Created agent, agent ID: ${agent.id}`);

  // Create a thread
  const thread = await client.threads.create();
  console.log(`Created thread, thread ID: ${thread.id}`);

  // Create a message
  const message = await client.messages.create(
    thread.id,
    "user",
    "Could you please create a bar chart in the TRANSPORTATION sector for the operating profit from the uploaded CSV file and provide the file to me?",
  );

  console.log(`Created message, message ID: ${message.id}`);

  // Create and execute a run
  const streamEventMessages = await client.runs.create(thread.id, agent.id).stream();

  for await (const eventMessage of streamEventMessages) {
    switch (eventMessage.event) {      case RunStreamEvent.ThreadRunCreated:
        // Type check or cast to access the status property safely
        if (typeof eventMessage.data === 'object' && eventMessage.data !== null && 'status' in eventMessage.data) {
          console.log(`ThreadRun status: ${eventMessage.data.status}`);
        } else {
          console.log(`ThreadRun created: ${JSON.stringify(eventMessage.data)}`);
        }
        break;
      case MessageStreamEvent.ThreadMessageDelta:
        {
          const messageDelta = eventMessage.data;
          // Type check or cast to access the delta property safely
          if (typeof messageDelta === 'object' && messageDelta !== null && 'delta' in messageDelta && 
              messageDelta.delta && 'content' in messageDelta.delta && Array.isArray(messageDelta.delta.content)) {
            messageDelta.delta.content.forEach((contentPart) => {
              if (contentPart.type === "text") {                const textContent = contentPart;
                // Add type guard for text content
                if ('text' in textContent && textContent.text && typeof textContent.text === 'object') {
                  const textValue = textContent.text.value || "No text";
                  console.log(`Text delta received:: ${textValue}`);
                }
              }
            });
          }
        }
        break;

      case RunStreamEvent.ThreadRunCompleted:
        console.log("Thread Run Completed");
        break;
      case ErrorEvent.Error:
        console.log(`An error occurred. Data ${eventMessage.data}`);
        break;
      case DoneEvent.Done:
        console.log("Stream completed.");
        break;
    }
  }

  // Delete the original file from the agent to free up space (note: this does not delete your version of the file)
  await client.files.delete(localFile.id);
  console.log(`Deleted file, file ID : ${localFile.id}`);

  // Print the messages from the agent
  const messagesIterator = client.messages.list(thread.id);
  const messagesArray = [];
  for await (const m of messagesIterator) {
    messagesArray.push(m);
  }
  console.log("Messages:", messagesArray);
  // Get most recent message from the assistant
  const assistantMessage = messagesArray.find((msg) => msg.role === "assistant");
  if (assistantMessage) {
    const textContent = assistantMessage.content.find((content) => isOutputOfType(content, "text"));
    if (textContent) {
      // Save the newly created file
      console.log(`Saving new files...`);
      const imageFileOutput = messagesArray[0].content[0];      // Use type checking to safely access the imageFile property
      let imageFileId = '';
      
      // Check if content has image file type and has the correct structure
      if (isOutputOfType(imageFileOutput, "image_file") && 
          'image_file' in imageFileOutput && 
          imageFileOutput.image_file && 
          typeof imageFileOutput.image_file === 'object') {
        // Use type assertion after validating the structure
        const typedImageFile = imageFileOutput.image_file as { fileId: string };
        if ('fileId' in typedImageFile && typeof typedImageFile.fileId === 'string') {
          imageFileId = typedImageFile.fileId;
        }
      }
      
      if (!imageFileId) {
        console.log("No image file found in the message content");
        return;
      }
      
      const imageFileName = path.resolve(
        "./data/" + (await client.files.get(imageFileId)).filename + "ImageFile.png",
      );
      console.log(`Image file name : ${imageFileName}`);

      const fileContent = await (await client.files.getContent(imageFileId).asNodeStream()).body;
      if (fileContent) {
        const chunks = [];
        for await (const chunk of fileContent) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        const buffer = Buffer.concat(chunks);
        fs.writeFileSync(imageFileName, buffer);
      } else {
        console.log("No file content available");
      }
    }
  }

  // Iterate through messages and print details for each annotation
  console.log(`Message Details:`);
  messagesArray.forEach((m) => {
    console.log(`File Paths:`);
    console.log(`Type: ${m.content[0].type}`);    if (isOutputOfType(m.content[0], "text")) {
      const textContent = m.content[0];
      // Use type guard to safely access text property
      if ('text' in textContent && textContent.text && typeof textContent.text === 'object' && 'value' in textContent.text) {
        console.log(`Text: ${textContent.text.value}`);
      }
    }
    console.log(`File ID: ${m.id}`);
    // firstId and lastId are properties of the paginator, not the messages array
    // Removing these references as they don't exist in this context
  });

  // Delete the agent once done
  await client.deleteAgent(agent.id);
  console.log(`Deleted agent, agent ID: ${agent.id}`);
}

main().catch((err) => {
  console.error("The sample encountered an error:", err);
});
