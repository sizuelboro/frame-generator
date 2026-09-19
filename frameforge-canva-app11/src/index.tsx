import { prepareDesignEditor } from "@canva/intents/design";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import "./styles.css";

prepareDesignEditor({
  render: async () => {
    const rootElement = document.getElementById("root");
    if (!rootElement) throw new Error("Missing #root element");
    createRoot(rootElement).render(<App />);
  },
});
