import { useEffect, useMemo, useRef, useState } from "react";
import EmptyState from "../components/EmptyState.jsx";
import ConfirmModal from "../components/ConfirmModal.jsx";
import Modal from "../components/Modal.jsx";
import Tabs from "../components/Tabs.jsx";
import EmailChipsInput from "../components/EmailChipsInput.jsx";
import {
  createDirectoryGroup,
  createDirectoryPerson,
  deleteDirectoryGroup,
  deleteDirectoryPerson,
  getDirectoryGroup,
  inviteDirectoryPeople,
  listDirectoryGroups,
  listDirectoryPeople,
  removeDirectoryGroupMembers,
  searchDirectoryPeople,
  updateDirectoryGroup
} from "../services/portalApi.js";

function normalize(value) {
  return String(value || "").trim();
}

function normalizeEmail(value) {
  return normalize(value).toLowerCase();
}

function normalizeEmailList(value) {
  const raw = String(value || "");
  const parts = raw
    .split(/[\n,;]+/g)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(parts));
}

export default function Contacts({ session, busy, onOpenBulk }) {
  const token = normalize(session?.token);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [writeForbidden, setWriteForbidden] = useState(false);

  const [mode, setMode] = useState("people"); // people | groups

  const [peopleQuery, setPeopleQuery] = useState("");
  const [people, setPeople] = useState([]);
  const [peopleTotal, setPeopleTotal] = useState(0);
  const [peopleOffset, setPeopleOffset] = useState(0);

  const [groups, setGroups] = useState([]);
  const [groupQuery, setGroupQuery] = useState("");
  const [groupId, setGroupId] = useState("");
  const [groupMembers, setGroupMembers] = useState([]);

  const [managePeopleOpen, setManagePeopleOpen] = useState(false);
  const [managePeopleTab, setManagePeopleTab] = useState("create"); // create | invite
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [manageGroupOpen, setManageGroupOpen] = useState(false);
  const [addMembersOpen, setAddMembersOpen] = useState(false);

  const [personEmail, setPersonEmail] = useState("");
  const [personFirstName, setPersonFirstName] = useState("");
  const [personLastName, setPersonLastName] = useState("");
  const [inviteEmails, setInviteEmails] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);

  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupManagerEmail, setNewGroupManagerEmail] = useState("");
  const [newGroupMemberEmails, setNewGroupMemberEmails] = useState("");
  const [groupAddEmails, setGroupAddEmails] = useState("");
  const [groupRename, setGroupRename] = useState("");
  const [groupManagerEmail, setGroupManagerEmail] = useState("");

  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerPeople, setPickerPeople] = useState([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState("");
  const [pickerOffset, setPickerOffset] = useState(0);
  const [pickerTotal, setPickerTotal] = useState(0);
  const [createPickedMemberIds, setCreatePickedMemberIds] = useState(() => new Set());
  const [managePickedMemberIds, setManagePickedMemberIds] = useState(() => new Set());

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmTitle, setConfirmTitle] = useState("Confirm");
  const [confirmMessage, setConfirmMessage] = useState("");
  const confirmActionRef = useRef(null);

  const openConfirm = ({ title, message, onConfirm }) => {
    confirmActionRef.current = typeof onConfirm === "function" ? onConfirm : null;
    setConfirmTitle(String(title || "Confirm"));
    setConfirmMessage(String(message || ""));
    setConfirmBusy(false);
    setConfirmOpen(true);
  };

  const [pickedEmails, setPickedEmails] = useState(() => new Set());

  const selectedCount = pickedEmails instanceof Set ? pickedEmails.size : 0;

  const selectedEmails = useMemo(() => Array.from(pickedEmails instanceof Set ? pickedEmails : []), [pickedEmails]);

  const refreshGroups = async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const data = await listDirectoryGroups({ token });
      setGroups(Array.isArray(data?.groups) ? data.groups : []);
    } catch (e) {
      setGroups([]);
      reportError(e, "Failed to load groups");
    } finally {
      setLoading(false);
    }
  };

  const refreshPeople = async ({ offset = 0, append = false } = {}) => {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const data = await listDirectoryPeople({ token, offset, limit: 25 });
      const list = Array.isArray(data?.people) ? data.people : [];
      const total = Number.isFinite(Number(data?.total)) ? Number(data.total) : list.length;
      setPeopleOffset(offset);
      setPeopleTotal(total);
      setPeople((prev) => (append ? [...(Array.isArray(prev) ? prev : []), ...list] : list));
    } catch (e) {
      if (!append) setPeople([]);
      setPeopleTotal(0);
      reportError(e, "Failed to load people");
    } finally {
      setLoading(false);
    }
  };

  const refreshSelectedGroupMembers = async (gid) => {
    const id = normalize(gid || groupId);
    if (!token || !id) return;
    if (writeForbidden) {
      setGroupMembers([]);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const data = await getDirectoryGroup({ token, groupId: id });
      setGroupMembers(Array.isArray(data?.members) ? data.members : []);
    } catch (e) {
      setGroupMembers([]);
      reportError(e, "Failed to load group members");
    } finally {
      setLoading(false);
    }
  };

  const refreshPicker = async ({ query = "", offset = 0, append = false } = {}) => {
    if (!token) return;
    const q = String(query || "").trim();
    setPickerLoading(true);
    setPickerError("");
    try {
      if (q) {
        const data = await searchDirectoryPeople({ token, query: q });
        const list = Array.isArray(data?.people) ? data.people : [];
        setPickerOffset(0);
        setPickerTotal(list.length);
        setPickerPeople(list);
        return;
      }

      const data = await listDirectoryPeople({ token, offset, limit: 50 });
      const list = Array.isArray(data?.people) ? data.people : [];
      const total = Number.isFinite(Number(data?.total)) ? Number(data.total) : list.length;
      setPickerOffset(offset);
      setPickerTotal(total);
      setPickerPeople((prev) => (append ? [...(Array.isArray(prev) ? prev : []), ...list] : list));
    } catch (e) {
      if (!append) setPickerPeople([]);
      setPickerOffset(0);
      setPickerTotal(0);
      setPickerError(e?.message || "Failed to load people");
    } finally {
      setPickerLoading(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    refreshGroups().catch(() => null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!token) return;
    if (mode !== "people") return;
    const q = normalize(peopleQuery);
    if (!q) {
      refreshPeople({ offset: 0, append: false }).catch(() => null);
      return;
    }

    setPeopleTotal(0);
    setPeopleOffset(0);
    setError("");
    const handle = setTimeout(() => {
      setLoading(true);
      searchDirectoryPeople({ token, query: q })
        .then((data) => setPeople(Array.isArray(data?.people) ? data.people : []))
        .catch((e) => {
          setPeople([]);
          reportError(e, "Failed to search people");
        })
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(handle);
  }, [mode, peopleQuery, token]);

  useEffect(() => {
    if (!token) return;
    if (mode !== "groups") return;
    const gid = normalize(groupId);
    if (!gid) {
      setGroupMembers([]);
      return;
    }
    if (writeForbidden) {
      setGroupMembers([]);
      return;
    }
    refreshSelectedGroupMembers(gid).catch(() => null);
  }, [groupId, mode, token, writeForbidden]);

  const toggleEmail = (email, on) => {
    const em = normalizeEmail(email);
    if (!em) return;
    setPickedEmails((prev) => {
      const next = new Set(prev instanceof Set ? prev : []);
      if (on) next.add(em);
      else next.delete(em);
      return next;
    });
  };

  const clearSelection = () => setPickedEmails(new Set());

  const sendToBulk = () => {
    if (!selectedEmails.length) return;
    window.dispatchEvent(new CustomEvent("portal:bulkRecipients", { detail: { emails: selectedEmails } }));
    onOpenBulk?.();
  };

  const filteredGroups = useMemo(() => {
    const q = normalize(groupQuery).toLowerCase();
    const list = Array.isArray(groups) ? groups : [];
    if (!q) return list;
    return list.filter((g) => String(g?.name || "").toLowerCase().includes(q));
  }, [groupQuery, groups]);

  const rows = mode === "groups" ? groupMembers : people;
  const shownEmails = useMemo(() => {
    const items = Array.isArray(rows) ? rows : [];
    return items.map((p) => normalizeEmail(p?.email)).filter(Boolean);
  }, [rows]);

  const allShownSelected = useMemo(() => {
    if (!(pickedEmails instanceof Set)) return false;
    if (!shownEmails.length) return false;
    return shownEmails.every((e) => pickedEmails.has(e));
  }, [pickedEmails, shownEmails]);

  const toggleAllShown = (on) => {
    setPickedEmails((prev) => {
      const next = new Set(prev instanceof Set ? prev : []);
      if (on) {
        for (const em of shownEmails) next.add(em);
      } else {
        for (const em of shownEmails) next.delete(em);
      }
      return next;
    });
  };
  const selectedGroup = useMemo(() => {
    const gid = normalize(groupId);
    if (!gid) return null;
    return (Array.isArray(groups) ? groups : []).find((g) => normalize(g?.id) === gid) || null;
  }, [groupId, groups]);

  useEffect(() => {
    // If auth changes, allow trying management actions again.
    setWriteForbidden(false);
  }, [token]);

  const canManageDirectory = Boolean(token) && !writeForbidden; // Server still enforces permissions; UI is optimistic.

  const toUiError = (value) => {
    const msg = String(value?.message || value || "").trim();
    if (!msg) return "";
    const first = msg.split(/\r?\n/g)[0] || "";
    return first.length > 240 ? `${first.slice(0, 239)}…` : first;
  };

  const isAccessDenied = (value) => {
    const msg = String(value?.message || value || "").toLowerCase();
    return msg.includes("forbidden") || msg.includes("access denied");
  };

  const reportError = (value, fallback) => {
    const msg = toUiError(value) || String(fallback || "Request failed");
    setError(msg);
    if (isAccessDenied(value) || isAccessDenied(msg)) {
      setWriteForbidden(true);
      setNotice("You can view contacts, but you don't have permission to manage directory data.");
    }
  };

  useEffect(() => {
    if (mode !== "groups") return;
    setGroupRename(selectedGroup?.name || "");
    setGroupManagerEmail("");
    setGroupAddEmails("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, groupId]);

  return (
    <div className="page-shell">
      <header className="topbar">
        <div>
          <h2>Contacts</h2>
          <p className="muted">Use people and groups as recipients.</p>
        </div>
        <div className="topbar-actions">
          {mode === "people" ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setManagePeopleTab("create");
                  setManagePeopleOpen(true);
                  setNotice("");
                  setError("");
                }}
                disabled={busy || loading || !canManageDirectory}
                title="Create a user profile (requires permissions)"
              >
                Add person
              </button>
              <button
                type="button"
                onClick={() => {
                  setManagePeopleTab("invite");
                  setManagePeopleOpen(true);
                  setNotice("");
                  setError("");
                }}
                disabled={busy || loading || !canManageDirectory}
                title="Send invite emails (requires permissions)"
              >
                Invite
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                setCreateGroupOpen(true);
                setNotice("");
                setError("");
                setPickerQuery("");
                setPickerPeople([]);
                setCreatePickedMemberIds(new Set());
                refreshPicker({ query: "", offset: 0, append: false }).catch(() => null);
              }}
              disabled={busy || loading || !canManageDirectory}
              title="Create a group (requires permissions)"
            >
              Create group
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setNotice("");
              setError("");
              refreshGroups().catch(() => null);
            }}
            disabled={busy || loading}
          >
            Refresh
          </button>
          <button type="button" onClick={clearSelection} disabled={busy || loading || selectedCount === 0}>
            Clear ({selectedCount})
          </button>
          <button type="button" className="primary" onClick={sendToBulk} disabled={busy || loading || selectedCount === 0} title="Send to Bulk send">
            Bulk send ({selectedCount})
          </button>
        </div>
      </header>

      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="notice">{notice}</p> : null}

      <Modal
        open={managePeopleOpen}
        title="People"
        onClose={() => {
          setManagePeopleOpen(false);
          setError("");
          setNotice("");
        }}
        actions={
          <button type="button" onClick={() => setManagePeopleOpen(false)}>
            Close
          </button>
        }
      >
        <div className="auth-form" style={{ marginTop: 0 }}>
          <div className="settings-tabs" style={{ marginTop: 0, marginBottom: 12 }}>
            <Tabs
              value={managePeopleTab}
              onChange={(v) => setManagePeopleTab(String(v || "create"))}
              ariaLabel="People actions"
              items={[
                { id: "create", label: "Create" },
                { id: "invite", label: "Invite" }
              ]}
            />
          </div>

          {managePeopleTab === "create" ? (
            <>
              <div>
                <strong>Create person</strong>
                <p className="muted" style={{ marginTop: 4 }}>
                  Creates a user profile (if your token has permissions).
                </p>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 12 }}>
                <label>
                  <span>Email</span>
                  <input value={personEmail} onChange={(e) => setPersonEmail(e.target.value)} placeholder="name@company.com" disabled={busy || loading} />
                </label>
                <label>
                  <span>First name</span>
                  <input value={personFirstName} onChange={(e) => setPersonFirstName(e.target.value)} placeholder="First" disabled={busy || loading} />
                </label>
                <label>
                  <span>Last name</span>
                  <input value={personLastName} onChange={(e) => setPersonLastName(e.target.value)} placeholder="Last" disabled={busy || loading} />
                </label>
              </div>
              <button
                type="button"
                className="primary"
                onClick={async () => {
                  if (!token) return;
                  setError("");
                  setNotice("");
                  const email = normalizeEmail(personEmail);
                  if (!email) {
                    setError("Email is required");
                    return;
                  }
                  setLoading(true);
                  try {
                    await createDirectoryPerson({
                      token,
                      email,
                      firstName: normalize(personFirstName),
                      lastName: normalize(personLastName)
                    });
                    setNotice("User created.");
                    setPersonEmail("");
                    setPersonFirstName("");
                    setPersonLastName("");
                    await refreshPeople({ offset: 0, append: false });
                  } catch (e) {
                    reportError(e, "Failed to create user");
                  } finally {
                    setLoading(false);
                  }
                }}
                disabled={busy || loading}
              >
                Create
              </button>
            </>
          ) : (
            <>
              <div>
                <strong>Invite people</strong>
                <p className="muted" style={{ marginTop: 4 }}>
                  Sends invites (if enabled on the server).
                </p>
              </div>
              <label>
                <span>Emails</span>
                <EmailChipsInput
                  value={inviteEmails}
                  onChange={setInviteEmails}
                  placeholder="Type an email and press Enter"
                  disabled={busy || loading || inviteBusy}
                />
              </label>
              <button
                type="button"
                className="primary"
                onClick={async () => {
                  if (!token) return;
                  const emails = normalizeEmailList(inviteEmails || personEmail);
                  if (!emails.length) {
                    setError("Emails are required for invite");
                    return;
                  }
                  setInviteBusy(true);
                  setError("");
                  setNotice("");
                  try {
                    await inviteDirectoryPeople({ token, emails });
                    setNotice("Invites sent.");
                    setInviteEmails("");
                  } catch (e) {
                    reportError(e, "Failed to invite people");
                  } finally {
                    setInviteBusy(false);
                  }
                }}
                disabled={busy || loading || inviteBusy}
              >
                Send invites
              </button>
            </>
          )}
        </div>
      </Modal>

      <Modal
        open={createGroupOpen}
        title="Create group"
        onClose={() => {
          setCreateGroupOpen(false);
          setError("");
          setNotice("");
        }}
        actions={
          <button type="button" onClick={() => setCreateGroupOpen(false)}>
            Close
          </button>
        }
      >
        <div className="auth-form" style={{ marginTop: 0 }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
            <label>
              <span>Group name</span>
              <input value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} placeholder="Finance approvals" disabled={busy || loading} />
            </label>
            <label>
              <span>Manager email (optional)</span>
              <input value={newGroupManagerEmail} onChange={(e) => setNewGroupManagerEmail(e.target.value)} placeholder="manager@company.com" disabled={busy || loading} />
            </label>
          </div>

          <label>
            <span>Member emails (optional)</span>
            <EmailChipsInput
              value={newGroupMemberEmails}
              onChange={setNewGroupMemberEmails}
              placeholder="Type an email and press Enter"
              disabled={busy || loading}
            />
          </label>

          <div className="card" style={{ margin: 0, padding: 12 }}>
            <div className="recipient-head" style={{ padding: 0, marginBottom: 8 }}>
              <strong>Pick members</strong>
              <span className="muted">{createPickedMemberIds instanceof Set ? createPickedMemberIds.size : 0} selected</span>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <input
                value={pickerQuery}
                onChange={(e) => {
                  const q = e.target.value;
                  setPickerQuery(q);
                  refreshPicker({ query: q, offset: 0, append: false }).catch(() => null);
                }}
                placeholder="Search people..."
                disabled={busy || loading || pickerLoading}
                style={{ maxWidth: 420 }}
              />
              <button
                type="button"
                onClick={() => {
                  setPickerQuery("");
                  refreshPicker({ query: "", offset: 0, append: false }).catch(() => null);
                }}
                disabled={busy || loading || pickerLoading}
              >
                Reset
              </button>
              <button
                type="button"
                onClick={() => setCreatePickedMemberIds(new Set())}
                disabled={busy || loading || pickerLoading || !(createPickedMemberIds instanceof Set ? createPickedMemberIds.size : 0)}
              >
                Clear
              </button>
            </div>
            {pickerError ? <p className="error" style={{ marginTop: 10 }}>{pickerError}</p> : null}
            {pickerLoading ? <EmptyState title="Loading people..." /> : null}
            {!pickerLoading && Array.isArray(pickerPeople) && pickerPeople.length ? (
              <div className="member-list is-compact" style={{ marginTop: 10 }}>
                {pickerPeople.map((u) => {
                  const id = String(u?.id || "").trim();
                  if (!id) return null;
                  const email = String(u?.email || "").trim();
                  const name = String(u?.displayName || u?.name || email || "User").trim();
                  const checked = createPickedMemberIds instanceof Set ? createPickedMemberIds.has(id) : false;
                  return (
                    <label key={id} className="check-row" title={email || id}>
                      <input
                        type="checkbox"
                        checked={Boolean(checked)}
                        onChange={(e) => {
                          const next = new Set(createPickedMemberIds instanceof Set ? createPickedMemberIds : []);
                          if (e.target.checked) next.add(id);
                          else next.delete(id);
                          setCreatePickedMemberIds(next);
                        }}
                        disabled={busy || loading || pickerLoading}
                      />
                      <span className="truncate">
                        <strong>{name}</strong>
                        {email ? <span className="muted">{" "}- {email}</span> : null}
                      </span>
                    </label>
                  );
                })}
              </div>
            ) : null}
            {!pickerLoading && !pickerQuery && pickerTotal > 0 && Array.isArray(pickerPeople) && pickerPeople.length < pickerTotal ? (
              <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 10 }}>
                <button type="button" onClick={() => refreshPicker({ query: "", offset: pickerPeople.length, append: true })} disabled={busy || loading || pickerLoading}>
                  Load more
                </button>
                <span className="muted">
                  Showing {pickerPeople.length} of {pickerTotal}
                </span>
              </div>
            ) : null}
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
            <button
              type="button"
              className="primary"
              onClick={async () => {
                if (!token) return;
                const name = normalize(newGroupName);
                if (!name) {
                  setError("Group name is required");
                  return;
                }
                const memberIds = Array.from(createPickedMemberIds instanceof Set ? createPickedMemberIds : []);
                setLoading(true);
                setError("");
                setNotice("");
                try {
                  await createDirectoryGroup({
                    token,
                    groupName: name,
                    managerEmail: normalizeEmail(newGroupManagerEmail),
                    memberEmails: newGroupMemberEmails,
                    memberIds
                  });
                  setNotice("Group created.");
                  setNewGroupName("");
                  setNewGroupManagerEmail("");
                  setNewGroupMemberEmails("");
                  setCreatePickedMemberIds(new Set());
                  setCreateGroupOpen(false);
                  await refreshGroups();
                } catch (e) {
                  reportError(e, "Failed to create group");
                } finally {
                  setLoading(false);
                }
              }}
              disabled={busy || loading}
            >
              Create group
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        open={manageGroupOpen}
        title={`Manage group${selectedGroup?.name ? ` — ${selectedGroup.name}` : ""}`}
        onClose={() => {
          setManageGroupOpen(false);
          setError("");
          setNotice("");
        }}
        actions={
          <button type="button" onClick={() => setManageGroupOpen(false)}>
            Close
          </button>
        }
      >
        <div className="auth-form" style={{ marginTop: 0 }}>
          {!normalize(groupId) ? (
            <EmptyState title="No group selected" description="Select a group and click Manage." />
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
                <label>
                  <span>Rename group</span>
                  <input value={groupRename} onChange={(e) => setGroupRename(e.target.value)} placeholder={selectedGroup?.name || "Group name"} disabled={busy || loading} />
                </label>
                <label>
                  <span>Manager email (optional)</span>
                  <input value={groupManagerEmail} onChange={(e) => setGroupManagerEmail(e.target.value)} placeholder="manager@company.com" disabled={busy || loading} />
                </label>
              </div>

              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={async () => {
                    if (!token) return;
                    const name = normalize(groupRename);
                    const manager = normalizeEmail(groupManagerEmail);
                    if (!name && !manager) return;
                    setLoading(true);
                    setError("");
                    setNotice("");
                    try {
                      await updateDirectoryGroup({ token, groupId, groupName: name, managerEmail: manager });
                      setNotice("Group updated.");
                      await refreshGroups();
                    } catch (e) {
                      reportError(e, "Failed to update group");
                    } finally {
                      setLoading(false);
                    }
                  }}
                  disabled={busy || loading}
                >
                  Save
                </button>

                <button
                  type="button"
                  className="danger"
                  onClick={async () => {
                    if (!token) return;
                    openConfirm({
                      title: "Delete group?",
                      message: `Delete group "${selectedGroup?.name || groupId}"?`,
                      onConfirm: async () => {
                        setConfirmBusy(true);
                        setLoading(true);
                        setError("");
                        setNotice("");
                        try {
                          await deleteDirectoryGroup({ token, groupId });
                          setNotice("Group deleted.");
                          setManageGroupOpen(false);
                          setGroupId("");
                          setGroupMembers([]);
                          await refreshGroups();
                        } catch (e) {
                          reportError(e, "Failed to delete group");
                        } finally {
                          setLoading(false);
                          setConfirmBusy(false);
                          setConfirmOpen(false);
                        }
                      }
                    });
                  }}
                  disabled={busy || loading}
                >
                  Delete
                </button>
              </div>

            </>
          )}
        </div>
      </Modal>

      <Modal
        open={addMembersOpen}
        title={`Add members${selectedGroup?.name ? ` — ${selectedGroup.name}` : ""}`}
        onClose={() => {
          setAddMembersOpen(false);
          setManagePickedMemberIds(new Set());
          setGroupAddEmails("");
          setPickerQuery("");
          setPickerError("");
          setError("");
          setNotice("");
        }}
        actions={
          <button
            type="button"
            onClick={() => {
              setAddMembersOpen(false);
              setManagePickedMemberIds(new Set());
              setGroupAddEmails("");
              setPickerQuery("");
              setPickerError("");
              setError("");
              setNotice("");
            }}
            disabled={busy || loading}
          >
            Close
          </button>
        }
      >
        <div className="auth-form" style={{ marginTop: 0 }}>
          {!normalize(groupId) ? (
            <EmptyState title="No group selected" description="Select a group, then click Add members." />
          ) : writeForbidden ? (
            <EmptyState title="Access denied" description="You can view groups, but you don't have permission to add members." />
          ) : (
            <>
              <label>
                <span>Add by email</span>
                <EmailChipsInput
                  value={groupAddEmails}
                  onChange={setGroupAddEmails}
                  placeholder="Type an email and press Enter"
                  disabled={busy || loading}
                />
              </label>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={async () => {
                    if (!token) return;
                    const emails = normalizeEmailList(groupAddEmails);
                    if (!emails.length) {
                      setError("Enter at least one email");
                      return;
                    }
                    setLoading(true);
                    setError("");
                    setNotice("");
                    try {
                      await updateDirectoryGroup({ token, groupId, addEmails: emails.join(",") });
                      setNotice("Members added.");
                      setGroupAddEmails("");
                      await refreshSelectedGroupMembers(groupId);
                      await refreshGroups();
                      setAddMembersOpen(false);
                    } catch (e) {
                      reportError(e, "Failed to add members");
                    } finally {
                      setLoading(false);
                    }
                  }}
                  disabled={busy || loading || !normalize(groupAddEmails) || !canManageDirectory}
                >
                  Add by email
                </button>
              </div>

              <div className="empty-state" style={{ marginTop: 10 }}>
                <strong>Or pick from list</strong>
                <p className="muted">Search people, select them, then add to the group.</p>
              </div>

              <div className="recipient-head" style={{ padding: 0, marginBottom: 8 }}>
                <strong>People</strong>
                <span className="muted">{managePickedMemberIds instanceof Set ? managePickedMemberIds.size : 0} selected</span>
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <input
                  value={pickerQuery}
                  onChange={(e) => {
                    const q = e.target.value;
                    setPickerQuery(q);
                    refreshPicker({ query: q, offset: 0, append: false }).catch(() => null);
                  }}
                  placeholder="Search people..."
                  disabled={busy || loading || pickerLoading}
                  style={{ maxWidth: 420 }}
                />
                <button
                  type="button"
                  onClick={() => {
                    setPickerQuery("");
                    refreshPicker({ query: "", offset: 0, append: false }).catch(() => null);
                  }}
                  disabled={busy || loading || pickerLoading}
                >
                  Reset
                </button>
                <button
                  type="button"
                  onClick={() => setManagePickedMemberIds(new Set())}
                  disabled={busy || loading || pickerLoading || !(managePickedMemberIds instanceof Set ? managePickedMemberIds.size : 0)}
                >
                  Clear
                </button>
              </div>
              {pickerError ? <p className="error" style={{ marginTop: 10 }}>{pickerError}</p> : null}
              {pickerLoading ? <EmptyState title="Loading people..." /> : null}
              {!pickerLoading && Array.isArray(pickerPeople) && pickerPeople.length ? (
                <div className="member-list is-compact" style={{ marginTop: 10 }}>
                  {pickerPeople.map((u) => {
                    const id = String(u?.id || "").trim();
                    if (!id) return null;
                    const email = String(u?.email || "").trim();
                    const name = String(u?.displayName || u?.name || email || "User").trim();
                    const checked = managePickedMemberIds instanceof Set ? managePickedMemberIds.has(id) : false;
                    return (
                      <label key={id} className="check-row" title={email || id}>
                        <input
                          type="checkbox"
                          checked={Boolean(checked)}
                          onChange={(e) => {
                            const next = new Set(managePickedMemberIds instanceof Set ? managePickedMemberIds : []);
                            if (e.target.checked) next.add(id);
                            else next.delete(id);
                            setManagePickedMemberIds(next);
                          }}
                          disabled={busy || loading || pickerLoading}
                        />
                        <span className="truncate">
                          <strong>{name}</strong>
                          {email ? <span className="muted">{" "}- {email}</span> : null}
                        </span>
                      </label>
                    );
                  })}
                </div>
              ) : null}
              {!pickerLoading && !pickerQuery && pickerTotal > 0 && Array.isArray(pickerPeople) && pickerPeople.length < pickerTotal ? (
                <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 10 }}>
                  <button type="button" onClick={() => refreshPicker({ query: "", offset: pickerPeople.length, append: true })} disabled={busy || loading || pickerLoading}>
                    Load more
                  </button>
                  <span className="muted">
                    Showing {pickerPeople.length} of {pickerTotal}
                  </span>
                </div>
              ) : null}
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
                <button
                  type="button"
                  className="primary"
                  onClick={async () => {
                    if (!token) return;
                    const ids = Array.from(managePickedMemberIds instanceof Set ? managePickedMemberIds : []);
                    if (!ids.length) return;
                    setLoading(true);
                    setError("");
                    setNotice("");
                    try {
                      await updateDirectoryGroup({ token, groupId, addIds: ids });
                      setNotice("Members added.");
                      setManagePickedMemberIds(new Set());
                      await refreshSelectedGroupMembers(groupId);
                      await refreshGroups();
                      setAddMembersOpen(false);
                    } catch (e) {
                      reportError(e, "Failed to add members");
                    } finally {
                      setLoading(false);
                    }
                  }}
                  disabled={busy || loading || !(managePickedMemberIds instanceof Set ? managePickedMemberIds.size : 0) || !canManageDirectory}
                >
                  Add selected ({managePickedMemberIds instanceof Set ? managePickedMemberIds.size : 0})
                </button>
              </div>
            </>
          )}
        </div>
      </Modal>

      <section className="card page-card" data-tour="contacts:recipients">
        <div className="card-header compact">
          <div>
            <h3>Recipients</h3>
            <p className="muted">Pick people directly, or select a group and pick members.</p>
            <p className="muted" style={{ margin: "6px 0 0" }}>
              Select people to build a list for Bulk send.
            </p>
          </div>
        </div>

        <div className="request-filters" style={{ alignItems: "center" }}>
          <Tabs
            value={mode}
            onChange={(v) => {
              setMode(String(v || "people"));
              setPeople([]);
              setPeopleQuery("");
              setPeopleTotal(0);
              setPeopleOffset(0);
              setGroupQuery("");
              setGroupId("");
              setGroupMembers([]);
              setError("");
              setNotice("");
            }}
            items={[
              { id: "people", label: "People" },
              { id: "groups", label: "Groups" }
            ]}
            ariaLabel="Contacts mode"
          />

          {mode === "people" ? (
            <div className="card-header-actions" style={{ alignItems: "center" }}>
              <input
                value={peopleQuery}
                onChange={(e) => setPeopleQuery(e.target.value)}
                placeholder="Filter or search people..."
                disabled={busy || loading}
                style={{ maxWidth: 420 }}
              />
              <span className="muted">{rows.length} shown</span>
            </div>
          ) : (
            <div className="card-header-actions" style={{ alignItems: "center" }}>
              <input
                value={groupQuery}
                onChange={(e) => setGroupQuery(e.target.value)}
                placeholder="Search groups..."
                disabled={busy || loading}
                style={{ maxWidth: 420 }}
              />
              <span className="muted">{filteredGroups.length} groups</span>
            </div>
          )}
        </div>

        {mode === "people" && !rows.length && !loading ? (
          <EmptyState title="No people found" description="The directory is empty, or this user has no access." />
        ) : null}

        {mode === "people" && normalize(peopleQuery) && !rows.length && !loading ? <EmptyState title="No results" description="Try a different search." /> : null}

        {mode === "groups" ? (
          <div className="contacts-groups-split" aria-label="Groups and members">
            <div className="contacts-pane" aria-label="Groups">
              <div className="contacts-pane-head">
                <strong>Groups</strong>
                <span className="muted">{filteredGroups.length} shown</span>
              </div>

              {!filteredGroups.length && !loading ? (
                <EmptyState title="No groups found" description="Groups may be hidden for this user, or there are no groups yet." />
              ) : (
                <div className="list scroll-area" aria-label="Groups list">
                  {filteredGroups.map((g) => {
                    const id = normalize(g?.id);
                    if (!id) return null;
                    const selected = id === normalize(groupId);
                    const name = normalize(g?.name) || "Group";
                    const membersCount = typeof g?.membersCount === "number" ? Number(g.membersCount) : null;
                    const membersLabel = membersCount === null ? "Group" : `${membersCount} members`;

                    return (
                      <div
                        key={id}
                        className={`select-row group-row${selected ? " is-selected" : ""}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => setGroupId(id)}
                        onKeyDown={(e) => {
                          if (e.key !== "Enter" && e.key !== " ") return;
                          e.preventDefault();
                          setGroupId(id);
                        }}
                        aria-pressed={selected}
                        title={name}
                      >
                        <div className="select-row-main">
                          <strong className="truncate">{name}</strong>
                          <span className="muted truncate">{membersLabel}</span>
                        </div>

                        <div className="group-row-right">
                          <button
                            type="button"
                            className="btn subtle"
                            onClick={(e) => {
                              e.stopPropagation();
                              setGroupId(id);
                              setManageGroupOpen(true);
                              setManagePickedMemberIds(new Set());
                              setPickerQuery("");
                              refreshPicker({ query: "", offset: 0, append: false }).catch(() => null);
                              refreshSelectedGroupMembers(id).catch(() => null);
                            }}
                            disabled={busy || loading || !canManageDirectory}
                            title="Manage this group"
                          >
                            Manage
                          </button>
                          <span className="select-row-right" aria-hidden="true">
                            {selected ? "\u2713" : ""}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="contacts-pane" aria-label="Group members">
              <div className="contacts-pane-head">
                <strong>Members{selectedGroup?.name ? ` — ${selectedGroup.name}` : ""}</strong>
                <div className="contacts-pane-actions">
                  <span className="muted">{normalize(groupId) ? `${rows.length} shown` : "Select a group"}</span>
                  {normalize(groupId) ? (
                    <button
                      type="button"
                      className="primary"
                      onClick={() => {
                        setManagePickedMemberIds(new Set());
                        setGroupAddEmails("");
                        setPickerQuery("");
                        refreshPicker({ query: "", offset: 0, append: false }).catch(() => null);
                        refreshSelectedGroupMembers(groupId).catch(() => null);
                        setAddMembersOpen(true);
                      }}
                      disabled={busy || loading || !canManageDirectory}
                      title={!canManageDirectory ? "Requires permissions" : "Add members to this group"}
                    >
                      Add members
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="contacts-pane-body">
                {!normalize(groupId) && !loading ? <EmptyState title="Choose a group" description="Select a group to load its members." /> : null}
                {normalize(groupId) && loading ? <EmptyState title="Loading members..." /> : null}
                {normalize(groupId) && writeForbidden && !loading ? (
                  <EmptyState title="Access denied" description="You can view groups, but you don't have permission to load or manage group members." />
                ) : null}
                {normalize(groupId) && !rows.length && !loading && !writeForbidden ? (
                  <EmptyState title="No members found" description="This group has no members available for selection." />
                ) : null}

                {normalize(groupId) && rows.length ? (
                  <>
                    {shownEmails.length ? (
                      <div className="card-header-actions" style={{ justifyContent: "space-between", alignItems: "center", gap: 10, marginTop: 6 }}>
                        <label className="inline-check">
                          <input
                            type="checkbox"
                            checked={allShownSelected}
                            onChange={(e) => toggleAllShown(Boolean(e.target.checked))}
                            disabled={busy || loading || shownEmails.length === 0}
                          />
                          <span>Select all shown</span>
                        </label>
                        {selectedCount ? (
                          <button type="button" className="link" onClick={clearSelection} disabled={busy || loading}>
                            Clear selection
                          </button>
                        ) : (
                          <span className="muted">{allShownSelected ? "All shown selected" : ""}</span>
                        )}
                      </div>
                    ) : null}

                    <div className="list scroll-area" aria-label="Group members list">
                      {rows.map((p) => {
                        const email = normalizeEmail(p?.email);
                        const name = normalize(p?.displayName) || normalize(p?.name) || email || "User";
                        const checked = email && pickedEmails instanceof Set ? pickedEmails.has(email) : false;
                        return (
                          <div
                            key={email || p?.id || Math.random()}
                            className={`select-row${checked ? " is-selected" : ""}`}
                            role="button"
                            tabIndex={0}
                            onClick={() => toggleEmail(email, !checked)}
                            onKeyDown={(e) => {
                              if (e.key !== "Enter" && e.key !== " ") return;
                              e.preventDefault();
                              toggleEmail(email, !checked);
                            }}
                            aria-pressed={checked}
                            title={email ? `${name} \u2014 ${email}` : name}
                          >
                            <div className="select-row-main">
                              <strong className="truncate">{name}</strong>
                              <span className="muted truncate">{email || "No email"}</span>
                            </div>

                            <div className="list-actions">
                              <span className="select-row-right" aria-hidden="true">
                                {checked ? "\u2713" : ""}
                              </span>

                              <button
                                type="button"
                                className="danger"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  if (!token) return;
                                  const memberId = String(p?.id || "").trim();
                                  if (!memberId) {
                                    setError("Member id is missing (cannot remove).");
                                    return;
                                  }
                                  openConfirm({
                                    title: "Remove member?",
                                    message: `Remove ${email || name} from this group?`,
                                    onConfirm: async () => {
                                      setConfirmBusy(true);
                                      setLoading(true);
                                      setError("");
                                      setNotice("");
                                      try {
                                        await removeDirectoryGroupMembers({ token, groupId, members: [memberId] });
                                        setNotice("Member removed.");
                                        await refreshSelectedGroupMembers(groupId);
                                        await refreshGroups();
                                      } catch (e2) {
                                        reportError(e2, "Failed to remove member");
                                      } finally {
                                        setLoading(false);
                                        setConfirmBusy(false);
                                        setConfirmOpen(false);
                                      }
                                    }
                                  });
                                }}
                                disabled={busy || loading || !canManageDirectory}
                                title="Remove user from group (admin only)"
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {mode === "people" && rows.length ? (
          <>
            {shownEmails.length ? (
              <div className="card-header-actions" style={{ justifyContent: "space-between", alignItems: "center", gap: 10, marginTop: 6 }}>
                <label className="inline-check">
                  <input
                    type="checkbox"
                    checked={allShownSelected}
                    onChange={(e) => toggleAllShown(Boolean(e.target.checked))}
                    disabled={busy || loading || shownEmails.length === 0}
                  />
                  <span>Select all shown</span>
                </label>
                {selectedCount ? (
                  <button type="button" className="link" onClick={clearSelection} disabled={busy || loading}>
                    Clear selection
                  </button>
                ) : (
                  <span className="muted">{allShownSelected ? "All shown selected" : ""}</span>
                )}
              </div>
            ) : null}

            <div className="list scroll-area">
              {rows.map((p) => {
                const email = normalizeEmail(p?.email);
                const name = normalize(p?.displayName) || normalize(p?.name) || email || "User";
                const checked = email && pickedEmails instanceof Set ? pickedEmails.has(email) : false;
                return (
                  <div
                    key={email || p?.id || Math.random()}
                    className={`select-row${checked ? " is-selected" : ""}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleEmail(email, !checked)}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" && e.key !== " ") return;
                      e.preventDefault();
                      toggleEmail(email, !checked);
                    }}
                    aria-pressed={checked}
                    title={email ? `${name} \u2014 ${email}` : name}
                  >
                    <div className="select-row-main">
                      <strong className="truncate">{name}</strong>
                      <span className="muted truncate">{email || "No email"}</span>
                    </div>

                    <div className="list-actions">
                      <span className="select-row-right" aria-hidden="true">
                        {checked ? "\u2713" : ""}
                      </span>

                      {mode === "people" ? (
                        <button
                          type="button"
                          className="danger"
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (!token) return;
                            const id = String(p?.id || "").trim();
                            if (!id) {
                              setError("User id is missing (cannot delete).");
                              return;
                            }
                            openConfirm({
                              title: "Delete user?",
                              message: `Delete ${email || name}?`,
                              onConfirm: async () => {
                                setConfirmBusy(true);
                                setLoading(true);
                                setError("");
                                setNotice("");
                                try {
                                  await deleteDirectoryPerson({ token, userId: id });
                                  setNotice("User deleted.");
                                  await refreshPeople({ offset: 0, append: false });
                                } catch (e2) {
                                  reportError(e2, "Failed to delete user");
                                } finally {
                                  setLoading(false);
                                  setConfirmBusy(false);
                                  setConfirmOpen(false);
                                }
                              }
                            });
                          }}
                          disabled={busy || loading || !canManageDirectory}
                          title="Delete user (admin only)"
                        >
                          Delete
                        </button>
                      ) : null}

                      {mode === "groups" && normalize(groupId) ? (
                        <button
                          type="button"
                          className="danger"
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (!token) return;
                            const memberId = String(p?.id || "").trim();
                            if (!memberId) {
                              setError("Member id is missing (cannot remove).");
                              return;
                            }
                            openConfirm({
                              title: "Remove member?",
                              message: `Remove ${email || name} from this group?`,
                              onConfirm: async () => {
                                setConfirmBusy(true);
                                setLoading(true);
                                setError("");
                                setNotice("");
                                try {
                                  await removeDirectoryGroupMembers({ token, groupId, members: [memberId] });
                                  setNotice("Member removed.");
                                  await refreshSelectedGroupMembers(groupId);
                                  await refreshGroups();
                                } catch (e2) {
                                  reportError(e2, "Failed to remove member");
                                } finally {
                                  setLoading(false);
                                  setConfirmBusy(false);
                                  setConfirmOpen(false);
                                }
                              }
                            });
                          }}
                          disabled={busy || loading || !canManageDirectory}
                          title="Remove user from group (admin only)"
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : null}

        {mode === "people" && !normalize(peopleQuery) && peopleTotal > 0 && people.length < peopleTotal ? (
          <div style={{ padding: "12px 16px 16px", display: "flex", gap: 12, alignItems: "center" }}>
            <button
              type="button"
              onClick={() => refreshPeople({ offset: people.length, append: true })}
              disabled={busy || loading}
              title="Load more people"
            >
              Load more
            </button>
            <span className="muted">
              Showing {people.length} of {peopleTotal}
            </span>
          </div>
        ) : null}
      </section>

      <ConfirmModal
        open={confirmOpen}
        title={confirmTitle}
        message={confirmMessage}
        confirmLabel="Confirm"
        cancelLabel="Cancel"
        busy={confirmBusy}
        onClose={() => {
          if (confirmBusy) return;
          setConfirmOpen(false);
        }}
        onConfirm={async () => {
          if (confirmBusy) return;
          const fn = confirmActionRef.current;
          if (typeof fn !== "function") {
            setConfirmOpen(false);
            return;
          }
          await fn();
        }}
      />
    </div>
  );
}

