import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentsPage } from "@/components/agents";
import { LiveProvider } from "@/components/data";
import { CurrentWork } from "@/components/running";

const tableHeaders = (page: ReactElement) =>
  [...renderToStaticMarkup(createElement(LiveProvider, null, page)).matchAll(/<th(?:\s[^>]*)?>([\s\S]*?)<\/th>/g)].map(
    (m) => m[1],
  );

describe("Current work's columns", () => {
  it("names the card's own column Status, and changes no other column", () => {
    expect(tableHeaders(createElement(CurrentWork))).toEqual([
      "Status",
      "Name / profile",
      "Model",
      "Task",
      "Machine",
      "Card",
      "Repo",
      "Running for",
    ]);
  });
});

describe("the Agents page's columns", () => {
  it("names the same column Status, in the running table and the agents table, as it did before the card", () => {
    expect(tableHeaders(createElement(AgentsPage))).toEqual([
      "Type",
      "Name / profile",
      "Model",
      "Task",
      "Machine",
      "Card",
      "Repo",
      "Running for",
      "Status",
      "Profile",
      "Note",
      "Type",
      "Model",
      "Machine",
      "Cron jobs",
    ]);
  });
});
