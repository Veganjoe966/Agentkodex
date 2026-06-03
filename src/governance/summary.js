'use strict';

const path = require('path');
const { readJson, readText } = require('../utils');
const { rootEvidencePath } = require('../audit/evidence');

function collectRunGovernance(root, runDir, input = {}) {
  const events = readEvidence(root, runDir);
  const auditEvidenceMissing = Boolean(runDir && events.length === 0);
  const quality = qualityFromEvidence(events) || qualityFromGates(runDir, input.gateResults);
  const status = input.status || (runDir ? readJson(path.join(runDir, 'status.json'), {}) : {});
  const securityDeniedCount = count(events, (e) => e.allowed === false && /security|denied_action/i.test(e.type || ''));
  const failedCapabilityCount = countUnique(events,
    (e) => e.allowed === false && /capability_validation|capability_verification_failure|signature_mismatch/i.test(e.type || ''),
    eventKey);
  const approvalRequiredCount = count(events, (e) => e.requiredApproval === true);
  const unsafeActionAttemptCount = countUnique(events,
    (e) => e.allowed === false && /denied_action|capability_validation|capability_verification_failure|signature_mismatch/i.test(e.type || ''),
    eventKey);
  const completionBlocked = Boolean(
    status.completionBlocked ||
    securityDeniedCount ||
    failedCapabilityCount ||
    quality?.ok === false ||
    auditEvidenceMissing ||
    /failed_(security|gates|agent_policy)|denied|blocked/.test(String(status.status || ''))
  );
  return {
    securityAllowed: securityDeniedCount === 0 && failedCapabilityCount === 0,
    securityDeniedCount,
    failedCapabilityCount,
    qualityGateOk: quality ? quality.ok : null,
    qualityViolationCount: quality ? quality.violations : 0,
    completionBlocked,
    auditEvidenceMissing,
    evidenceEventCount: events.length,
    approvalRequiredCount,
    unsafeActionAttemptCount,
  };
}

function collectRootGovernance(root) {
  return collectRunGovernance(root, null, {});
}

function blocksCompletion(governance = {}) {
  return Boolean(
    governance.completionBlocked ||
    Number(governance.failedCapabilityCount || 0) > 0 ||
    Number(governance.securityDeniedCount || 0) > 0 ||
    Number(governance.approvalRequiredCount || 0) > 0 ||
    governance.auditEvidenceMissing === true ||
    governance.qualityGateOk === false
  );
}

function readEvidence(root, runDir) {
  const files = runDir ? [path.join(runDir, 'audit-evidence.jsonl'), rootEvidencePath(root)] : [rootEvidencePath(root)];
  const seen = new Set();
  const seenLines = new Set();
  const events = [];
  for (const file of files) {
    if (seen.has(file)) continue;
    seen.add(file);
    for (const line of readText(file, '').split(/\r?\n/)) {
      if (!line.trim()) continue;
      if (seenLines.has(line)) continue;
      seenLines.add(line);
      try {
        const event = JSON.parse(line);
        if (!runDir || file !== rootEvidencePath(root) || event.runDir === runDir) events.push(event);
      } catch (_) {}
    }
  }
  return events;
}

function qualityFromEvidence(events) {
  const qualityEvents = events.filter((event) => event.type === 'quality_gate_result');
  if (!qualityEvents.length) return null;
  const failed = qualityEvents.filter((event) => event.ok === false);
  const selected = failed[0] || qualityEvents[qualityEvents.length - 1];
  const violations = qualityEvents.reduce((sum, event) => sum + violationCount(event.checks || []), 0);
  return { ok: failed.length === 0 && Boolean(selected.ok), violations };
}

function qualityFromGates(runDir, gateResults) {
  if (!runDir && !gateResults) return null;
  const gates = gateResults || readJson(path.join(runDir || '', 'gate-results.json'), []);
  const gate = (gates || []).find((item) => item.gate === 'quality');
  if (!gate) return null;
  const data = gate.outputPath ? readJson(gate.outputPath, null) : null;
  const ok = Boolean(data?.ok ?? gate.result?.exitCode === 0);
  return { ok, violations: violationCount(data?.checks || []) };
}

function violationCount(checks) {
  return (checks || []).reduce((sum, check) => sum + Number(check.errors || 0), 0);
}

function count(items, predicate) {
  return items.reduce((sum, item) => sum + (predicate(item) ? 1 : 0), 0);
}

function countUnique(items, predicate, keyFn) {
  const seen = new Set();
  for (const item of items) {
    if (!predicate(item)) continue;
    seen.add(keyFn(item));
  }
  return seen.size;
}

function eventKey(event) {
  return [
    event.capability?.capabilityId || event.capabilityId || event.command || event.type,
    event.reason || '',
    event.expected?.sessionId || '',
  ].join(':');
}

module.exports = {
  collectRunGovernance,
  collectRootGovernance,
  blocksCompletion,
  readEvidence,
};
