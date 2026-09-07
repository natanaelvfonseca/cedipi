import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "../app/page";
import "../app/globals.css";
import { AuthProvider } from "../app/auth-context";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider><App /></AuthProvider>
  </StrictMode>,
);
