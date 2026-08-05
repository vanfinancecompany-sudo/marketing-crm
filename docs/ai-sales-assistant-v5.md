# AI Sales Assistant V5

V5 adds a deterministic human-conversation and recovery layer before the existing intent, retrieval and application-journey stages. It remains part of the protected internal simulation only.

## Recovery behaviour

- Every message receives a universal message type, confidence, customer emotion and objection assessment.
- Confused, nonsensical, random, off-topic and low-confidence input bypasses retrieval and model generation.
- Recovery replies never search for or answer nonsense and never echo an unknown phrase inside an awkward product question.
- Short agreement, disagreement, uncertainty, humour and positive feedback use recent conversation and journey context.
- Business objections continue through approved evidence retrieval, with the objection and emotion supplied to the grounded prompt.
- The model never receives authority to override product locking, deterministic rules, approved sources or Application Mode.

## Confidence and repetition

Messages below the confidence threshold stop the normal answer path and ask for natural clarification. Recent assistant wording is fingerprinted for internal repetition diagnostics, and the grounded prompt is told which recent terms to avoid repeating mechanically.

## Simulation coverage

V5 adds 120 balanced Finance/Rent2Buy scenarios containing more than 300 messages across confusion, short replies, typos, slang, nonsense, off-topic changes, humour, frustration, objections, contextual time phrases, repeated questions and interrupted or abandoned conversations.

No database migration is required because V5 diagnostics use the existing `conversation_diagnostics` JSONB field.
