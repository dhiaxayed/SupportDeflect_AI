/** Crisp HTML composition explaining how a source passage becomes an answer, without WebGL. */
import { ArrowDown, ArrowUpRight, FileText, MessageCircle } from "lucide-react";

/** A readable explanation of retrieval. Native HTML stays crisp at every viewport. */
export function KnowledgeVisual() {
  return (
    <div
      className="sd-answer-composition"
      role="img"
      aria-label="A sentence from your widget setup guide becomes a clear answer with a source"
    >
      <div className="sd-composition-caption">
        <span>THE ANSWER IS ALREADY THERE.</span>
        <span>01 — 02</span>
      </div>
      <article className="sd-source-paper">
        <div className="sd-paper-meta">
          <FileText size={15} /> Your product guide <span>01</span>
        </div>
        <h3>
          Make it feel
          <br />
          like you.
        </h3>
        <p>
          Good support belongs in your product.
          <br />
          Give your assistant a familiar face.
        </p>
        <p className="sd-paper-evidence">
          <span className="sd-evidence-highlight" aria-hidden="true" />
          <span>
            Choose your colors, logo and welcome
            <br className="sd-paper-break" /> message in Widget Design Studio.
          </span>
        </p>
        <div className="sd-paper-rule" aria-hidden="true" />
        <span className="sd-paper-footnote">WIDGET SETUP / BRANDING</span>
      </article>
      <div className="sd-answer-bridge" aria-hidden="true">
        <span />
        <ArrowDown size={15} />
      </div>
      <article className="sd-answer-paper">
        <div className="sd-answer-paper-meta">
          <MessageCircle size={16} />
          <span>Your customer asks</span>
          <ArrowUpRight size={17} />
        </div>
        <h3>
          “Can I make it
          <br />
          match my brand?”
        </h3>
        <div className="sd-answer-paper-result">
          <span className="sd-answer-tick">↳</span>
          <p>
            Yes. Make it yours in
            <br />
            <strong>Widget Design Studio.</strong>
          </p>
        </div>
        <div className="sd-answer-paper-source">
          <FileText size={12} /> Your product guide <span>Source included</span>
        </div>
      </article>
      <div className="sd-composition-footnote">
        <span>YOUR KNOWLEDGE</span>
        <span>A CLEARER CONVERSATION</span>
      </div>
    </div>
  );
}
