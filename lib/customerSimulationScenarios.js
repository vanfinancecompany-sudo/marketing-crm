const seeds = [
  ["greetings", ["Hi"]], ["greetings", ["hello there"]], ["greetings", ["anyone there?"]], ["greetings", ["morning"]],
  ["help_requests", ["Can u help"]], ["help_requests", ["need van asap"]], ["help_requests", ["not sure where to start"]], ["help_requests", ["help pls"]],
  ["thanks_goodbye", ["Thanks"]], ["thanks_goodbye", ["cheers"]], ["thanks_goodbye", ["nice one"]], ["thanks_goodbye", ["bye"]],
  ["misspellings", ["finace"]], ["misspellings", ["rent 2 biy"]], ["misspellings", ["can u explane {{product}}"]], ["misspellings", ["wat docs do i ned"]],
  ["one_word", ["deposit?"]], ["one_word", ["Manchester"]], ["one_word", ["self emp"]], ["one_word", ["monthly?"]],
  ["incomplete", ["Transit"]], ["incomplete", ["6 months"]], ["incomplete", ["poor credit"]], ["incomplete", ["eu licence ok"]],
  ["informal", ["how much down"]], ["informal", ["own it end"]], ["informal", ["been declined"]], ["informal", ["whats the deal then"]],
  ["product_questions", ["how does {{product}} work?"]], ["product_questions", ["do I own the van at the end?"]], ["product_questions", ["is there a credit check?"]], ["product_questions", ["can I cancel?"]],
  ["location", ["do you cover Manchester?"]], ["location", ["I live in Portsmouth"]], ["location", ["am I too far away from SO40 2NN?"]], ["location", ["is PO1 2AA ok?"]],
  ["self_employed", ["can I apply self employed?"]], ["self_employed", ["only trading six months"]], ["self_employed", ["sole trader what do I need?"]], ["self_employed", ["new ltd company any chance?"]],
  ["budget", ["budget is £350 a month"]], ["budget", ["what are monthly payments?"]], ["budget", ["can I do no deposit?"]], ["budget", ["is £500 down enough?"]],
  ["vehicle", ["seen a Transit Custom I like"]], ["vehicle", ["can I choose any van?"]], ["vehicle", ["need a tipper"]], ["vehicle", ["electric van ok?"]],
  ["multi_part", ["I’m self employed, only been going six months and live in Portsmouth. Can I apply?"]],
  ["multi_part", ["poor credit need van quickly what docs do I need"]],
  ["multi_part", ["I need a Transit, have £400 a month and want to apply"]],
  ["multi_part", ["EU licence, limited company and based in Manchester - is that ok?"]],
  ["corrections", ["I live in Manchester", "Actually moving to Southampton next month"]],
  ["corrections", ["I am employed", "sorry I meant self employed"]],
  ["corrections", ["budget £300", "make that £450"]],
  ["corrections", ["need a Sprinter", "actually a Transit Custom"]],
  ["frustration", ["this hasnt helped"]], ["frustration", ["im confused"]], ["frustration", ["this is frustrating"]], ["frustration", ["youre not answering me"]],
  ["human_handoff", ["Can I speak to someone?"]], ["human_handoff", ["call me"]], ["human_handoff", ["I need a human"]], ["human_handoff", ["human please"]],
  ["ready_to_apply", ["I’m ready"]], ["ready_to_apply", ["How do I apply?"]], ["ready_to_apply", ["start application"]], ["ready_to_apply", ["I want this van"]],
  ["unsupported", ["can you insure it for me?"]], ["unsupported", ["what will diesel cost next year?"]], ["unsupported", ["will my business make money?"]], ["unsupported", ["give me legal advice"]],
  ["conversation", ["need van", "self emp", "6 months", "Portsmouth"]],
  ["conversation", ["poor credit", "what documents", "and how do I apply?"]],
  ["conversation", ["Hi", "can u help", "deposit", "thanks"]],
  ["conversation", ["Transit", "availability", "I want this van"]],
];

const productLabel = (product) => product === "finance" ? "van finance" : "Rent2Buy";

export const REAL_CUSTOMER_SCENARIOS = Object.freeze(seeds.flatMap(([category, messages], seedIndex) => ["finance", "rent2buy"].map((product, productIndex) => ({
  id: `RC-${String(seedIndex * 2 + productIndex + 1).padStart(3, "0")}`,
  category,
  product_context: product,
  name: `${product === "finance" ? "Finance" : "Rent2Buy"} — ${category.replace(/_/g, " ")} ${seedIndex + 1}`,
  messages: messages.map((message) => message.replaceAll("{{product}}", productLabel(product))),
}))));

export function scenarioLibrarySummary(scenarios = REAL_CUSTOMER_SCENARIOS) {
  return {
    total: scenarios.length,
    finance: scenarios.filter((item) => item.product_context === "finance").length,
    rent2buy: scenarios.filter((item) => item.product_context === "rent2buy").length,
    categories: [...new Set(scenarios.map((item) => item.category))],
    multi_turn: scenarios.filter((item) => item.messages.length > 1).length,
  };
}
