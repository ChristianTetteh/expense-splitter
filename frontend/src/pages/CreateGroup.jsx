import { useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";

const MIN_MEMBERS = 2;
const MAX_MEMBERS = 30;

export default function CreateGroup() {
  const navigate = useNavigate();
  const [groupName, setGroupName] = useState("");
  const [members, setMembers] = useState(["", ""]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function updateMember(index, value) {
    setMembers((prev) => prev.map((m, i) => (i === index ? value : m)));
  }

  function addMemberRow() {
    if (members.length >= MAX_MEMBERS) return;
    setMembers((prev) => [...prev, ""]);
  }

  function removeMemberRow(index) {
    if (members.length <= MIN_MEMBERS) return;
    setMembers((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    const cleanedMembers = members.map((m) => m.trim()).filter(Boolean);
    if (groupName.trim().length < 2) {
      setError("Give this tab a name.");
      return;
    }
    if (cleanedMembers.length < MIN_MEMBERS) {
      setError(`Add at least ${MIN_MEMBERS} people to split with.`);
      return;
    }

    setBusy(true);
    try {
      const res = await api.post("/groups", { name: groupName.trim(), members: cleanedMembers });
      navigate(`/groups/${res.data.group.id}`);
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't start that tab. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="pad">
        <p className="pad-eyebrow">New tab</p>
        <h1 className="pad-title">Who's splitting the bill?</h1>
        <p className="pad-sub">
          Name the tab, list who's in it, then add what everyone paid for. Tally works out who
          owes whom — no account needed, just share the link.
        </p>

        <form onSubmit={handleSubmit} className="pad-form">
          <label className="pad-field">
            <span>Tab name</span>
            <input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Weekend in Kumasi"
              maxLength={80}
            />
          </label>

          <div className="pad-field">
            <span>People</span>
            <ul className="member-rows">
              {members.map((name, index) => (
                <li key={index} className="member-row">
                  <span className="member-row-index">{index + 1}</span>
                  <input
                    value={name}
                    onChange={(e) => updateMember(index, e.target.value)}
                    placeholder={`Person ${index + 1}`}
                    maxLength={50}
                  />
                  {members.length > MIN_MEMBERS && (
                    <button
                      type="button"
                      className="member-row-remove"
                      onClick={() => removeMemberRow(index)}
                      aria-label={`Remove person ${index + 1}`}
                    >
                      ×
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {members.length < MAX_MEMBERS && (
              <button type="button" className="btn-add-row" onClick={addMemberRow}>
                + Add another person
              </button>
            )}
          </div>

          {error && <p className="form-error">{error}</p>}

          <button className="btn-primary" type="submit" disabled={busy}>
            {busy ? "Starting…" : "Start the tab"}
          </button>
        </form>
      </div>
    </div>
  );
}
