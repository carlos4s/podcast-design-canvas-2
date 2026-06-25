"use strict";

// Speaker role ordering regression suite for Podcast Design Canvas (#135, #137).
// Run with: `node tests/speaker-role-naming.test.js`.

const assert = require("assert");
const setup = require("../app/episode-setup.js");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok ${name}`);
}

function speakersWithRoles(roles) {
  return roles.map((role) => setup.createSpeaker(role));
}

function rolesOf(speakers) {
  return speakers.map((speaker) => speaker.role);
}

function removeSpeaker(speakers, removeIndex) {
  const next = speakers.slice();
  next.splice(removeIndex, 1);
  setup.normalizeDefaultSpeakerRoles(next);
  return next;
}

function addSpeaker(speakers) {
  const next = speakers.slice();
  next.push(setup.createSpeaker(setup.nextAvailableSpeakerRole(next)));
  setup.normalizeDefaultSpeakerRoles(next);
  return next;
}

test("createDraft seeds Host, Guest 1, and Guest 2 without duplicates", () => {
  const draft = setup.createDraft();
  assert.deepStrictEqual(rolesOf(draft.speakers), ["Host", "Guest 1", "Guest 2"]);
  assert.strictEqual(new Set(rolesOf(draft.speakers)).size, 3);
});

test("normalizeDefaultSpeakerRoles compacts Host and Guest labels after a removal", () => {
  const speakers = speakersWithRoles(["Host", "Guest 1", "Guest 2"]);
  speakers.splice(1, 1);
  setup.normalizeDefaultSpeakerRoles(speakers);
  assert.deepStrictEqual(rolesOf(speakers), ["Host", "Guest 1"]);
});

test("nextAvailableSpeakerRole assigns Guest 3 after the default trio", () => {
  const speakers = speakersWithRoles(["Host", "Guest 1", "Guest 2"]);
  assert.strictEqual(setup.nextAvailableSpeakerRole(speakers), "Guest 3");
});

test("defaultSpeakerRoleForIndex maps list order to Host then numbered guests", () => {
  assert.strictEqual(setup.defaultSpeakerRoleForIndex(0), "Host");
  assert.strictEqual(setup.defaultSpeakerRoleForIndex(1), "Guest 1");
  assert.strictEqual(setup.defaultSpeakerRoleForIndex(2), "Guest 2");
  assert.strictEqual(setup.defaultSpeakerRoleForIndex(3), "Guest 3");
});

test("roleSelectOptions includes the current role and the next auto-assigned guest", () => {
  const speakers = speakersWithRoles(["Host", "Guest 1", "Guest 2"]);
  const options = setup.roleSelectOptions(speakers, "Guest 2");
  assert.ok(options.includes("Guest 2"));
  assert.ok(options.includes("Guest 3"));
});

test("ACCEPTANCE: remove Guest 1 then add speakers yields Host, Guest 1, Guest 2, Guest 3", () => {
  let speakers = setup.createDraft().speakers;

  speakers = removeSpeaker(speakers, 1);
  assert.deepStrictEqual(rolesOf(speakers), ["Host", "Guest 1"]);

  speakers = addSpeaker(speakers);
  assert.deepStrictEqual(rolesOf(speakers), ["Host", "Guest 1", "Guest 2"]);

  speakers = addSpeaker(speakers);
  assert.deepStrictEqual(rolesOf(speakers), ["Host", "Guest 1", "Guest 2", "Guest 3"]);
  assert.strictEqual(new Set(rolesOf(speakers)).size, 4);
});

console.log(`\nspeaker role naming: ${passed} assertions passed`);
