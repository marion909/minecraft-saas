import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ServerStatus } from "../generated/prisma/enums.ts";
import type { AgentServerState } from "./agent.ts";
import { mapAgentStatus } from "./server-status-map.ts";

function agentState(
  status: AgentServerState["status"],
  ready = false,
): AgentServerState {
  return {
    serverId: "cmsttestserver0000000001",
    status,
    containerId: status === "absent" ? null : "abc123",
    containerRunning: status === "running" || status === "starting",
    ready,
    exitCode: 0,
    startedAt: null,
    usage: null,
    storage: "directory",
  };
}

describe("mapAgentStatus", () => {
  it("übernimmt die laufenden Zustände vom Agent", () => {
    assert.equal(
      mapAgentStatus(agentState("running", true), ServerStatus.STARTING),
      ServerStatus.RUNNING,
    );
    assert.equal(
      mapAgentStatus(agentState("stopped"), ServerStatus.RUNNING),
      ServerStatus.STOPPED,
    );
  });

  it("beendet PROVISIONING, sobald der Container existiert", () => {
    // Der Kern des Fehlers, der beim ersten Panel-Durchlauf auffiel:
    // Ohne diesen Übergang blieb ein fertig angelegter Server für immer
    // auf "wird eingerichtet" stehen.
    assert.equal(
      mapAgentStatus(agentState("created"), ServerStatus.PROVISIONING),
      ServerStatus.STOPPED,
    );
  });

  it("hält PROVISIONING, solange der Container noch fehlt", () => {
    assert.equal(
      mapAgentStatus(agentState("absent"), ServerStatus.PROVISIONING),
      ServerStatus.PROVISIONING,
    );
  });

  it("meldet einen verschwundenen Container als Fehler", () => {
    assert.equal(
      mapAgentStatus(agentState("absent"), ServerStatus.RUNNING),
      ServerStatus.FAILED,
    );
  });

  it("lässt eine Sperre von keinem Zustand des Agents aufheben", () => {
    for (const status of ["running", "stopped", "absent"] as const) {
      assert.equal(
        mapAgentStatus(agentState(status), ServerStatus.SUSPENDED),
        ServerStatus.SUSPENDED,
      );
    }
  });

  it("hält DELETING, bis die Zeile selbst verschwindet", () => {
    assert.equal(
      mapAgentStatus(agentState("running"), ServerStatus.DELETING),
      ServerStatus.DELETING,
    );
  });
});
