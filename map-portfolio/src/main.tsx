import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "cesium/Build/Cesium/Widgets/widgets.css";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/responsive.css";
import { App } from "./app/App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
