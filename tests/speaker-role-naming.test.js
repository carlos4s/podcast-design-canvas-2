"use strict";

// Speaker role auto-assignment regression suite for Podcast Design Canvas (#135).
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

function rolesAfterAdd(currentRoles) {
  const speakers = speakersWithRoles(currentRoles);
  return setup.createSpeaker(setup.nextAvailableSpeakerRole(speakers)).role;
}

function rolesAfterRemoveAndAdd(currentRoles, removeIndex) {
  const speakers = speakersWithRoles(currentRoles);
  speakers.splice(removeIndex, 1);
  return setup.createSpeaker(setup.nextAvailableSpeakerRole(speakers)).role;
}

test("createDraft seeds Host, Guest 1, and Guest 2 without duplicates", () => {
  const draft = setup.createDraft();
  const roles = draft.speakers.map((speaker) => speaker.role);
  assert.deepStrictEqual(roles, ["Host", "Guest 1", "Guest 2"]);
  assert.strictEqual(new Set(roles).size, roles.length);
});

test("nextAvailableSpeakerRole assigns Guest 3 after the default trio", () => {
  assert.strictEqual(
    rolesAfterAdd(["Host", "Guest 1", "Guest 2"]),
    "Guest 3",
  );
});

test("nextAvailableSpeakerRole reuses Guest 1 after that source is removed", () => {
  assert.strictEqual(
    rolesAfterRemoveAndAdd(["Host", "Guest 1", "Guest 2"], 1),
    "Guest 1",
  );
});

test("nextAvailableSpeakerRole reuses Guest 2 after that source is removed", () => {
  assert.strictEqual(
    rolesAfterRemoveAndAdd(["Host", "Guest 1", "Guest 2"], 2),
    "Guest 2",
  );
});

test("nextAvailableSpeakerRole keeps climbing Guest numbers when lower slots stay filled", () => {
  assert.strictEqual(
    rolesAfterAdd(["Host", "Guest 1", "Guest 2", "Guest 3"]),
    "Guest 4",
  );
  assert.strictEqual(
    rolesAfterAdd(["Host", "Guest 1", "Guest 2", "Guest 3", "Guest 4"]),
    "Co-host",
  );
});

test("nextAvailableSpeakerRole assigns Guest 5 after preset buckets are taken", () => {
  assert.strictEqual(
    rolesAfterAdd(["Host", "Guest 1", "Guest 2", "Guest 3", "Guest 4", "Co-host"]),
    "Guest 5",
  );
});

test("roleSelectOptions includes the current role and the next auto-assigned guest", () => {
  const speakers = speakersWithRoles(["Host", "Guest 1", "Guest 2"]);
  const options = setup.roleSelectOptions(speakers, "Guest 2");
  assert.ok(options.includes("Guest 2"));
  assert.ok(options.includes("Guest 3"));
  assert.ok(options.indexOf("Guest 3") > options.indexOf("Guest 2"));
});

test("ACCEPTANCE: add/remove speaker sources always yields unique auto-assigned roles", () => {
  const sequences = [
    { start: ["Host", "Guest 1", "Guest 2"], remove: 1, expect: "Guest 1" },
    { start: ["Host", "Guest 1", "Guest 2"], remove: 2, expect: "Guest 2" },
    { start: ["Host", "Guest 1", "Guest 2"], remove: null, expect: "Guest 3" },
    { start: ["Host", "Guest 2", "Guest 3"], remove: 0, expect: "Host" },
  ];

  sequences.forEach((scenario) => {
    let nextRole;
    if (scenario.remove === null) {
      nextRole = rolesAfterAdd(scenario.start);
    } else {
      nextRole = rolesAfterRemoveAndAdd(scenario.start, scenario.remove);
    }
    assert.strictEqual(nextRole, scenario.expect);

    const speakers = speakersWithRoles(scenario.start);
    if (scenario.remove !== null) {
      speakers.splice(scenario.remove, 1);
    }
    speakers.push(setup.createSpeaker(nextRole));
    const roles = speakers.map((speaker) => speaker.role);
    assert.strictEqual(new Set(roles).size, roles.length, JSON.stringify(roles));
  });
});

console.log(`\nspeaker role naming: ${passed} assertions passed`);
