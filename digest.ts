import {
  webSearchTool,
  RunContext,
  Agent,
  AgentInputItem,
  Runner,
  withTrace,
} from "@openai/agents";
import { z } from "zod";
import "dotenv/config";
import nodemailer from "nodemailer";

// --- ENV helpers (added) ---
const parseNum = (v: string | undefined, def: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};

const parseBool = (v: string | undefined, def: boolean) => {
  if (v == null) return def;
  const s = v.trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(s)) return true;
  if (["false", "0", "no", "n", "off"].includes(s)) return false;
  return def;
};

const parseTopics = (v: string | undefined) => {
  if (!v) return [];
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
};

const parseLocations = (v: string | undefined): string[] => {
  if (!v) return [];
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
};

const parseRecipientEmails = (
  v: string | undefined,
  defaultEmail: string,
): string[] => {
  if (!v) return [defaultEmail];
  const list = v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length > 0 ? list : [defaultEmail];
};

// Tool definitions
const webSearchPreview = webSearchTool({
  searchContextSize: "medium",
  userLocation: {
    type: "approximate",
  },
});
const HackathonNewsSchema = z.object({
  items: z.array(
    z.object({
      title: z.string(),
      summary: z.string(),
      publisher: z.string(),
      url: z.string(),
      category: z.string(), // e.g. "Hackathon (Denver)", "Hackathon (Czech Republic)", "Programming Challenge (Swift)"
      date: z.string(), // Event/deadline or publication date
    }),
  ),
});
interface HackathonNewsContext {
  stateRecencyHours: string;
  stateLocations: string;
  stateChallengeFocus: string;
  stateMaxItems: string;
  stateLanguage: string;
}
const hackathonNewsInstructions = (
  runContext: RunContext<HackathonNewsContext>,
  _agent: Agent<HackathonNewsContext, typeof HackathonNewsSchema>,
) => {
  const {
    stateRecencyHours,
    stateLocations,
    stateChallengeFocus,
    stateMaxItems,
    stateLanguage,
  } = runContext.context;
  return `You are an agent for finding HACKATHONS and PROGRAMMING CHALLENGES the user can sign up for.
You must use the web search tool. Do not respond from memory. Return only items that come from the search results (URLs must not be made up).

LOCATIONS to search (include results from all of these):
${stateLocations}
- For "near me" use the approximate user location from the search context when available.

PROGRAMMING CHALLENGES to include:
${stateChallengeFocus}
Examples: Apple Swift Student Challenge, WWDC Swift challenges, React/JavaScript coding competitions, web development hackathons and challenges, coding contests the user can register for.

Goal: Find hackathons and programming challenges from the last ${stateRecencyHours} hours (or with upcoming deadlines in that window). Prefer events that are open for registration or have an upcoming deadline.

Quality rules:
- Each item must have a URL, publisher, and date (event date, registration deadline, or publication date).
- Use category to indicate type and location, e.g. "Hackathon (Denver)", "Hackathon (Czech Republic)", "Programming Challenge (Swift)", "Hackathon (Near me)".
- Prefer: Devpost, official hackathon sites, Apple/Google developer challenges, major coding competition platforms, Czech and Denver-area event listings.
- Summary: 5 to 10 sentences describing the hackathon or challenge in detail (what it is, who it's for, dates/deadlines, prizes or benefits, how to sign up); mention location or "online" when relevant.
- Date: YYYY-MM-DD or relative (e.g. "deadline March 15, 2025").

Find at least 10 items when possible (across all locations and challenge types); return up to ${stateMaxItems} items. If you don't find anything relevant for a location or category, still return what you find for others. Output language: ${stateLanguage} (cs = Czech, en = English).
The output must be exactly one valid JSON object matching the schema (no markdown, no extra text). Inside JSON strings do not use raw newlines; use spaces or \\n. Ensure every string is properly closed so the JSON is valid.`;
};
const hackathonNewsAgent = new Agent<
  HackathonNewsContext,
  typeof HackathonNewsSchema
>({
  name: "Hackathon News Search Agent",
  instructions: hackathonNewsInstructions,
  model: "gpt-4.1",
  tools: [webSearchPreview],
  outputType: HackathonNewsSchema,
  modelSettings: {
    temperature: 1,
    topP: 1,
    maxTokens: 16384, // Large enough for 10+ items with 5–10 sentence summaries
    store: true,
  },
});

// Format email from news items
const formatEmailFromNews = (
  items: Array<{
    title: string;
    summary: string;
    publisher: string;
    url: string;
    category: string;
    date: string;
  }>,
  language: string = "en",
): { subject: string; body: string } => {
  if (items.length === 0) {
    return {
      subject: "No Hackathons or Challenges Found",
      body: "No relevant hackathons or programming challenges were found for the specified criteria.",
    };
  }

  // Get current date for subject (in Denver timezone GMT-7)
  const currentDate = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "America/Denver", // Use Denver timezone to get correct date
  });

  // Generate a concise subject from the first few items
  const firstTitles = items
    .slice(0, 3)
    .map((item) => item.title)
    .join(", ");
  const titlesPart =
    firstTitles.length > 50
      ? firstTitles.substring(0, 47) + "..."
      : firstTitles;

  // Format the email body
  const bodyLines: string[] = [];
  if (language === "cs") {
    bodyLines.push("Hackathony a programovací výzvy (týdenní přehled):\n");
  } else {
    bodyLines.push("Hackathons & Programming Challenges (weekly digest):\n");
  }

  items.forEach((item, index) => {
    bodyLines.push(
      `${index + 1}. [${item.category}] ${item.title} (${item.date})`,
    );
    bodyLines.push(`   ${item.summary}`);
    bodyLines.push(`   Source: ${item.publisher} - ${item.url}`);
    bodyLines.push(""); // Empty line between items
  });

  return {
    subject: `${currentDate} - Hackathons & Challenges: ${titlesPart}`,
    body: bodyLines.join("\n"),
  };
};

// Email sending function (to can be one address or comma-separated / array of addresses)
const sendEmail = async (
  to: string | string[],
  subject: string,
  body: string,
): Promise<void> => {
  const recipients = Array.isArray(to) ? to : [to];
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_SECURE === "true", // true for 465, false for other ports
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD || process.env.SMTP_APP_PASSWORD, // Use app password for Gmail
    },
  });

  if (!process.env.SMTP_USER) {
    throw new Error(
      "SMTP_USER environment variable is required. Please set it in GitHub Secrets.",
    );
  }
  if (!process.env.SMTP_PASSWORD && !process.env.SMTP_APP_PASSWORD) {
    throw new Error(
      "SMTP_PASSWORD or SMTP_APP_PASSWORD environment variable is required. Please set it in GitHub Secrets.",
    );
  }

  const info = await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: recipients,
    subject: subject,
    text: body,
    html: body.replace(/\n/g, "<br>"), // Convert newlines to HTML breaks
  });

  console.log(
    `Email sent successfully to ${recipients.join(", ")}! Message ID: ${info.messageId}`,
  );
};

type WorkflowInput = { input_as_text: string };

// Main code entrypoint
export const runWorkflow = async (workflow: WorkflowInput) => {
  return await withTrace("Hackathon news agent", async () => {
    // Validate required environment variables
    if (!process.env.OPENAI_API_KEY) {
      throw new Error(
        "OPENAI_API_KEY environment variable is required. Please set it in GitHub Secrets.",
      );
    }

    const defaultLocations = [
      "Denver, Colorado (and nearby)",
      "Czech Republic (Česko – whole country: Praha, Brno, Ostrava, etc.)",
      "Near me (user's approximate location)",
    ];
    const defaultChallengeFocus = [
      "Apple Swift Student Challenge, WWDC Swift challenges",
      "Swift programming challenges and competitions",
      "React and JavaScript coding challenges",
      "Web development hackathons and coding competitions",
    ];
    const state = {
      language: process.env.LANGUAGE ?? "en",
      locations: parseLocations(process.env.LOCATIONS).length
        ? parseLocations(process.env.LOCATIONS)
        : defaultLocations,
      challengeFocus: parseTopics(process.env.CHALLENGE_TOPICS).length
        ? parseTopics(process.env.CHALLENGE_TOPICS)
        : defaultChallengeFocus,
      recency_hours: parseNum(process.env.RECENCY_HOURS, 168), // 7 days for weekly digest
      max_items: parseNum(process.env.MAX_ITEMS, 36),
      must_include_sources: parseBool(process.env.MUST_INCLUDE_SOURCES, true),
      recipient_emails: parseRecipientEmails(
        process.env.RECIPIENT_EMAIL,
        "danmitka@gmail.com",
      ),
    };

    console.log("Workflow state:", {
      language: state.language,
      locations: state.locations,
      challengeFocus: state.challengeFocus,
      recency_hours: state.recency_hours,
      max_items: state.max_items,
      recipient_emails: state.recipient_emails,
    });

    const conversationHistory: AgentInputItem[] = [
      {
        role: "user",
        content: [{ type: "input_text", text: workflow.input_as_text }],
      },
    ];
    const runner = new Runner({
      traceMetadata: {
        __trace_source__: "agent-builder",
        workflow_id: "wf_hackathon_news_digest",
      },
    });
    const newsSearchResultTemp = await runner.run(
      hackathonNewsAgent,
      [
        ...conversationHistory,
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `User request: {
          Locations: ${state.locations.join("; ")}
          Programming challenges focus: ${state.challengeFocus.join("; ")}
          Time window: last ${state.recency_hours} hours (weekly digest)
          Find hackathons in these locations and programming challenges (Swift, React, web) the user can sign up for. Return at least 10 items when possible (up to the max). Return structured JSON with category indicating type and location (e.g. "Hackathon (Denver)", "Programming Challenge (Swift)"). For each item write a summary of 5 to 10 sentences: describe the hackathon/challenge in detail (what it is, who it's for, dates/deadlines, prizes or benefits, how to sign up). Include event or deadline date for each item.`,
            },
          ],
        },
      ],
      {
        context: {
          stateRecencyHours: String(state.recency_hours),
          stateLocations: state.locations.join("\n"),
          stateChallengeFocus: state.challengeFocus.join("\n"),
          stateMaxItems: String(state.max_items),
          stateLanguage: state.language,
        },
      },
    );
    conversationHistory.push(
      ...newsSearchResultTemp.newItems.map(
        (item: { rawItem: AgentInputItem }) => item.rawItem,
      ),
    );

    if (!newsSearchResultTemp.finalOutput) {
      throw new Error("Agent result is undefined");
    }

    const newsSearchResult = {
      output_text: JSON.stringify(newsSearchResultTemp.finalOutput),
      output_parsed: newsSearchResultTemp.finalOutput,
    };

    // Format and send email directly from news items
    if (newsSearchResult.output_parsed.items.length > 0) {
      const emailContent = formatEmailFromNews(
        newsSearchResult.output_parsed.items,
        state.language,
      );
      const emailSubject = emailContent.subject;

      let emailSent = false;
      try {
        if (!process.env.SMTP_USER) {
          console.warn(
            "⚠️  SMTP_USER not set. Skipping email send. Set SMTP secrets in GitHub to enable email.",
          );
        } else {
          await sendEmail(
            state.recipient_emails,
            emailSubject,
            emailContent.body,
          );
          console.log(`✅ Email sent to ${state.recipient_emails.join(", ")}`);
          emailSent = true;
        }
      } catch (error) {
        console.error("❌ Failed to send email:", error);
        if (error instanceof Error) {
          console.error("Email error details:", error.message);
        }
        // Continue and return result even if email fails
      }

      return {
        output_text: JSON.stringify(newsSearchResult.output_parsed),
        output_parsed: newsSearchResult.output_parsed,
        email: {
          subject: emailSubject,
          body: emailContent.body,
          sent: emailSent,
        },
      };
    } else {
      console.log("ℹ️  No news items found to send.");
      return newsSearchResult;
    }
  });
};

// Run the workflow if this file is executed directly
if (typeof require !== "undefined" && require.main === module) {
  (async () => {
    try {
      const input =
        process.argv[2] ||
        "Find hackathons in Denver, Czech Republic, and near me; plus programming challenges (Swift, React, web) I can sign up for.";
      console.log(`Running workflow with input: "${input}"`);
      console.log(`Environment check:`, {
        hasOpenAIKey: !!process.env.OPENAI_API_KEY,
        hasSmtpUser: !!process.env.SMTP_USER,
        recipientCount: parseRecipientEmails(
          process.env.RECIPIENT_EMAIL,
          "danmitka@gmail.com",
        ).length,
      });
      const result = await runWorkflow({ input_as_text: input });
      console.log("\nResult:", JSON.stringify(result, null, 2));
      console.log("\n✅ Workflow completed successfully!");
      process.exit(0);
    } catch (error) {
      console.error("\n❌ Error running workflow:", error);
      if (error instanceof Error) {
        console.error("Error message:", error.message);
        console.error("Error stack:", error.stack);
      }
      // Exit with code 1 to indicate failure
      process.exit(1);
    }
  })();
}
