/** Deterministic illustrations, never document IDs or responses from a connected model. */
export const demoScenarios = [
  {
    id: "branding",
    label: "Customize the widget",
    short: "Widget customization",
    question: "How can I customize my support widget?",
    answer:
      "Open Widget Design Studio in your workspace. Choose your colors, add your logo, and adjust the welcome message and launcher position. Save your design to apply it to your embedded widget.",
    source: "Widget customization guide",
    file: "widget-guide.md",
    section: "Branding & appearance",
    excerpt:
      "Customize the brand name, logo, colors, welcome message and launcher position in Widget Design Studio. Save changes to update the widget.",
    stage: "Matching the customization guide",
    tag: "Answer grounded in a source",
  },
  {
    id: "knowledge",
    label: "Find an answer",
    short: "Knowledge retrieval",
    question: "Which documents can I connect to my assistant?",
    answer:
      "You can upload PDF, Markdown and plain-text documents, or import supported public website URLs. Add your product guides and FAQs in the Documents area, then let ingestion finish before testing your assistant.",
    source: "Knowledge setup guide",
    file: "knowledge-setup.md",
    section: "Supported knowledge sources",
    excerpt:
      "Upload PDF, Markdown and TXT files, or import a supported public URL. Documents are processed into searchable knowledge for your organization.",
    stage: "Finding the relevant knowledge",
    tag: "Relevant knowledge, retrieved",
  },
  {
    id: "handoff",
    label: "Bring in a human",
    short: "Human escalation",
    question: "Can you investigate a charge on my account?",
    answer:
      "I don’t have the account details needed to investigate a charge. This needs a person. Your support team can review questions that need human help, with conversation context, in the support inbox.",
    source: null,
    file: "Outside the sample knowledge",
    section: "Human support",
    excerpt:
      "Account-specific questions need a person. An escalation keeps the original question and conversation available for the support team to review.",
    stage: "Checking the available knowledge",
    tag: "A clear path to human help",
  },
] as const;
