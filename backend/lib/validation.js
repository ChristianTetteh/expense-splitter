const { parseDollarsToCents } = require("./money");

const MIN_GROUP_MEMBERS = 2;
const MAX_GROUP_MEMBERS = 30;

function cleanName(name) {
  return typeof name === "string" ? name.trim().replace(/\s+/g, " ") : "";
}

function validateMemberName(name) {
  const cleaned = cleanName(name);
  if (cleaned.length < 1 || cleaned.length > 50) {
    return { error: "A member's name must be between 1 and 50 characters." };
  }
  return { name: cleaned };
}

// Validates the payload for creating a group: a group name plus its
// starting roster of member names. A group needs at least two people or
// there's nothing to split, and names must be unique within the group
// (case-insensitively) since the UI picks a payer/participant by name.
function validateGroupInput({ name, members }) {
  const cleanedName = cleanName(name);
  if (cleanedName.length < 2 || cleanedName.length > 80) {
    return { error: "Group name must be between 2 and 80 characters." };
  }

  if (!Array.isArray(members) || members.length < MIN_GROUP_MEMBERS) {
    return { error: `Add at least ${MIN_GROUP_MEMBERS} members to start a group.` };
  }
  if (members.length > MAX_GROUP_MEMBERS) {
    return { error: `A group can have at most ${MAX_GROUP_MEMBERS} members.` };
  }

  const cleanedMembers = [];
  const seen = new Set();
  for (const raw of members) {
    const result = validateMemberName(raw);
    if (result.error) return { error: result.error };
    const key = result.name.toLowerCase();
    if (seen.has(key)) return { error: `"${result.name}" is listed more than once.` };
    seen.add(key);
    cleanedMembers.push(result.name);
  }

  return { name: cleanedName, members: cleanedMembers };
}

// Validates adding one more member to an existing group. `existingNames` is
// the group's current member names, lower-cased, for the same uniqueness
// check validateGroupInput does up front.
function validateNewMember({ name }, existingNames) {
  const result = validateMemberName(name);
  if (result.error) return { error: result.error };
  if (existingNames.has(result.name.toLowerCase())) {
    return { error: `"${result.name}" is already in this group.` };
  }
  return { name: result.name };
}

// Validates an expense: a description, a positive dollar amount, a payer
// who's actually in the group, and a participant list (who the cost is
// split between) that's either explicitly given or defaults to the whole
// group. `memberIds` is the Set of valid member ids for this group.
function validateExpenseInput({ description, amount, payer_id, participant_ids }, memberIds) {
  const cleanedDescription = cleanName(description);
  if (cleanedDescription.length < 1 || cleanedDescription.length > 200) {
    return { error: "Description must be between 1 and 200 characters." };
  }

  const amountCents = parseDollarsToCents(amount);
  if (amountCents === null) {
    return { error: "Enter a valid positive amount, with at most 2 decimal places." };
  }

  const payerId = Number(payer_id);
  if (!Number.isInteger(payerId) || !memberIds.has(payerId)) {
    return { error: "Select who paid from this group's members." };
  }

  let participantIds;
  if (participant_ids === undefined || participant_ids === null) {
    participantIds = Array.from(memberIds);
  } else {
    if (!Array.isArray(participant_ids) || participant_ids.length === 0) {
      return { error: "Select at least one person to split this expense between." };
    }
    const unique = Array.from(new Set(participant_ids.map(Number)));
    for (const id of unique) {
      if (!Number.isInteger(id) || !memberIds.has(id)) {
        return { error: "One of the selected participants isn't in this group." };
      }
    }
    participantIds = unique;
  }

  return { description: cleanedDescription, amountCents, payerId, participantIds };
}

module.exports = { MIN_GROUP_MEMBERS, MAX_GROUP_MEMBERS, validateGroupInput, validateNewMember, validateExpenseInput };
