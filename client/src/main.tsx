import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { registerGetPhasesForCategory } from "./lib/data";
import { getPhasesForCategory } from "./lib/sop-templates";

// Register category-aware phase resolver to avoid circular imports
registerGetPhasesForCategory(getPhasesForCategory);

createRoot(document.getElementById("root")!).render(<App />);
