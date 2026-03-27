import { useEffect, useMemo, useState } from "react";
import DocSpaceModal from "../components/DocSpaceModal.jsx";
import AuditModal from "../components/AuditModal.jsx";
import EmptyState from "../components/EmptyState.jsx";
import EmailChipsInput from "../components/EmailChipsInput.jsx";
import Modal from "../components/Modal.jsx";
import RequestDetailsModal from "../components/RequestDetailsModal.jsx";
import StatusPill from "../components/StatusPill.jsx";
import Tabs from "../components/Tabs.jsx";
import { toast } from "../utils/toast.js";
import {
  activateProject,
  cancelFlow,
  completeFlow,
  deleteProjectTemplateFromProject,
  listDrafts,
  getProjectMembers,
  getProjectsSidebar,
  inviteProject,
  listProjectFlows,
  listSharedTemplates,
  listProjectTemplates,
  publishDraft,
  removeProjectMember
} from "../services/portalApi.js";

function normalize(value) {
  return String(value || "").trim();
}

function accessLabel(value) {
  if (typeof value === "number") {
    if (value === 0) return "No access";
    if (value === 1) return "Project viewer";
    if (value === 2) return "Project editor";
    if (value === 3) return "Project reviewer";
    if (value === 4) return "Project commenter";
    if (value === 5) return "Form respondent";
    if (value === 6) return "Form author";
    if (value >= 7) return "Project admin";
    return `Access ${value}`;
  }
  const v = String(value || "").toLowerCase();
  if (v === "fillforms") return "Form respondent";
  if (v === "readwrite") return "Project editor";
  if (v === "roommanager") return "Project admin";
  if (v === "read") return "Project viewer";
  return value || "-";
}

function isPdfTemplate(t) {
  const ext = String(t?.fileExst || "").trim().toLowerCase();
  const title = String(t?.title || "").trim().toLowerCase();
  return ext === "pdf" || ext === ".pdf" || title.endsWith(".pdf");
}

function withFillAction(url) {
  const raw = String(url || "");
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    parsed.searchParams.set("action", "fill");
    return parsed.toString();
  } catch {
    return raw.includes("?") ? `${raw}&action=fill` : `${raw}?action=fill`;
  }
}

function formatRecipients(value) {
  const list = Array.isArray(value)
    ? Array.from(
        new Set(
          value
            .map((e) => String(e || "").trim())
            .filter(Boolean)
        )
      )
    : [];
  if (!list.length) return { count: 0, short: "", full: "" };
  if (list.length === 1) return { count: 1, short: list[0], full: list[0] };
  return { count: list.length, short: `${list[0]} +${list.length - 1}`, full: list.join(", ") };
}


function normalizeKind(value) {
  const v = String(value || "").trim().toLowerCase();
  if (v === "fillsign" || v === "fill-sign" || v === "fill_sign" || v === "sign") return "fillSign";
  if (v === "sharedsign" || v === "shared-sign" || v === "shared_sign" || v === "contract") return "sharedSign";
  return "approval";
}

export default function Project({ session, busy, projectId, onBack, onStartFlow, onOpenDrafts }) {
  const token = session?.token || "";
  const meId = session?.user?.id ? String(session.user.id) : "";
  const meEmail = session?.user?.email ? String(session.user.email).trim().toLowerCase() : "";
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [tab, setTab] = useState("requests");
  const [peopleQuery, setPeopleQuery] = useState("");
  const [formsQuery, setFormsQuery] = useState("");
  const [requestsQuery, setRequestsQuery] = useState("");
  const [requestsWho, setRequestsWho] = useState("assigned");
  const [requestsWhoTouched, setRequestsWhoTouched] = useState(false);

  const [project, setProject] = useState(null);
  const [members, setMembers] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [projectFlows, setProjectFlows] = useState([]);
  const [flowsLoading, setFlowsLoading] = useState(false);
  const [flowsError, setFlowsError] = useState("");
  const [flowsCanManage, setFlowsCanManage] = useState(false);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [invite, setInvite] = useState({
    emails: "",
    access: "FillForms",
    notify: false,
    message: ""
  });
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removeEntry, setRemoveEntry] = useState(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelEntry, setCancelEntry] = useState(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [completeEntry, setCompleteEntry] = useState(null);
  const [completeBusy, setCompleteBusy] = useState(false);
  const [docOpen, setDocOpen] = useState(false);
  const [docTitle, setDocTitle] = useState("Document");
  const [docUrl, setDocUrl] = useState("");
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditFlow, setAuditFlow] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsGroup, setDetailsGroup] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [addFormOpen, setAddFormOpen] = useState(false);
  const [addFormSource, setAddFormSource] = useState("my"); // my | shared
  const [addFormQuery, setAddFormQuery] = useState("");
  const [addFormLoading, setAddFormLoading] = useState(false);
  const [addFormError, setAddFormError] = useState("");
  const [addFormMyDocs, setAddFormMyDocs] = useState([]);
  const [addFormShared, setAddFormShared] = useState([]);
  const [addFormSelected, setAddFormSelected] = useState(null);
  const [creatingTemplateId, setCreatingTemplateId] = useState("");
  const [removeTemplateOpen, setRemoveTemplateOpen] = useState(false);
  const [removeTemplateEntry, setRemoveTemplateEntry] = useState(null);
  const [removeTemplateBusy, setRemoveTemplateBusy] = useState(false);

  const isArchivedProject = Boolean(project?.archivedAt);
  const isProjectReadOnly = isArchivedProject;

  const refresh = async () => {
    const pid = normalize(projectId);
    if (!pid) return;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const [sidebarRes, membersRes] = await Promise.all([
        getProjectsSidebar({ token }).catch(() => null),
        getProjectMembers({ token, projectId: pid })
      ]);
      const list = Array.isArray(sidebarRes?.projects) ? sidebarRes.projects : [];
      const found = list.find((p) => String(p.id) === pid) || null;
      setProject(found || membersRes?.project || null);
      setMembers(Array.isArray(membersRes?.members) ? membersRes.members : []);

      const isArchivedProject = Boolean(found?.archivedAt);

      if (found?.id && !isArchivedProject) {
        await activateProject(found.id).catch(() => null);
        window.dispatchEvent(new CustomEvent("portal:projectChanged"));
      }

      if (token) {
        const templatesRes = await listProjectTemplates({ token, projectId: pid }).catch(() => null);
        setTemplates(Array.isArray(templatesRes?.templates) ? templatesRes.templates : []);
      } else {
        setTemplates([]);
      }
    } catch (e) {
      setError(e?.message || "Failed to load project");
      setProject(null);
      setMembers([]);
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  };

  const refreshFlows = async () => {
    const pid = normalize(projectId);
    const t = normalize(token);
    if (!pid || !t) {
      setProjectFlows([]);
      setFlowsCanManage(false);
      return;
    }

    setFlowsLoading(true);
    setFlowsError("");
    try {
      const res = await listProjectFlows({ token: t, projectId: pid });
      const nextFlows = Array.isArray(res?.flows) ? res.flows : [];
      const nextCanManage = Boolean(res?.canManage);
      setProjectFlows(nextFlows);
      setFlowsCanManage(nextCanManage);

      if (!requestsWhoTouched) {
        if (nextCanManage) {
          setRequestsWho("all");
        } else if (String(requestsWho || "") === "all") {
          setRequestsWho("assigned");
        }
      }
    } catch (e) {
      setProjectFlows([]);
      setFlowsCanManage(false);
      setFlowsError(e?.message || "Failed to load requests");
    } finally {
      setFlowsLoading(false);
    }
  };

  useEffect(() => {
    refresh().catch(() => null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, token]);

  useEffect(() => {
    if (tab !== "requests") return;
    // If the user switches projects while staying on the Requests tab,
    // ensure we don't keep showing the previous project's list.
    setProjectFlows([]);
    setFlowsError("");
    refreshFlows().catch(() => null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, projectId, token]);

  useEffect(() => {
    if (!autoRefresh) return;
    if (tab !== "requests") return;
    if (!normalize(token)) return;
    if (!projectFlows.some((f) => String(f?.status || "") === "InProgress")) return;

    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      if (busy || loading || flowsLoading) return;
      refreshFlows().catch(() => null);
    }, 25000);

    return () => clearInterval(id);
  }, [autoRefresh, busy, flowsLoading, loading, projectFlows, refreshFlows, tab, token]);

  useEffect(() => {
    const handler = () => {
      if (tab !== "requests") return;
      refreshFlows().catch(() => null);
    };
    window.addEventListener("portal:flowsChanged", handler);
    return () => window.removeEventListener("portal:flowsChanged", handler);
  }, [tab]);

  const normalizedMembers = useMemo(() => {
    const items = Array.isArray(members) ? members : [];
    return items
      .map((m) => ({
        key: m?.user?.id || m?.group?.id || JSON.stringify(m || {}),
        userId: m?.user?.id ? String(m.user.id) : "",
        type: m?.user?.id ? "user" : m?.group?.id ? "group" : String(m?.subjectType || "other"),
        title: m?.user?.displayName || m?.group?.name || "Unknown",
        subtitle: m?.user?.email || "",
        access: m?.access || null,
        isOwner: Boolean(m?.isOwner),
        canRevoke: Boolean(m?.canRevoke)
      }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [members]);

  const filteredMembers = useMemo(() => {
    const q = normalize(peopleQuery).toLowerCase();
    if (!q) return normalizedMembers;
    return normalizedMembers.filter((m) => {
      const hay = `${m.title || ""} ${m.subtitle || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [normalizedMembers, peopleQuery]);

  const canManageProject = useMemo(() => {
    if (!meId) return false;
    const items = Array.isArray(members) ? members : [];
    const me =
      items.find((m) => m?.user?.id && String(m.user.id) === meId) ||
      null;
    if (!me) return false;
    if (me?.isOwner) return true;
    if (typeof me?.access === "number") return me.access >= 7;
    const access = String(me?.access || "").toLowerCase();
    if (/^\\d+$/.test(access)) return Number(access) >= 7;
    return access === "roommanager" || access === "roomadmin";
  }, [members, meId]);

  const myRoleLabel = useMemo(() => {
    if (!meId) return "Member";
    const items = Array.isArray(members) ? members : [];
    const me = items.find((m) => m?.user?.id && String(m.user.id) === meId) || null;
    if (!me) return "Member";
    if (me?.isOwner) return "Project admin";
    if (typeof me?.access === "number" && me.access >= 7) return "Project admin";
    const access = String(me?.access || "").toLowerCase();
    if (/^\\d+$/.test(access) && Number(access) >= 7) return "Project admin";
    if (access === "roommanager" || access === "roomadmin") return "Project admin";
    return accessLabel(me?.access);
  }, [members, meId]);

  const onInvite = async () => {
    const pid = normalize(project?.id);
    const emails = normalize(invite.emails);
    if (!pid || !emails) return;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const data = await inviteProject({
        token,
        projectId: pid,
        emails,
        access: invite.access,
        notify: invite.notify,
        message: invite.message
      });
      setInviteOpen(false);
      setInvite((s) => ({ ...s, emails: "", message: "" }));
      setNotice(`Invited ${data?.invited || 0} user(s).`);
      toast("Invites sent", "success");
      await refresh();
    } catch (e) {
      setError(e?.message || "Invite failed");
    } finally {
      setLoading(false);
    }
  };

  const onOpenRemove = (member) => {
    setRemoveEntry(member || null);
    setRemoveOpen(true);
    setError("");
    setNotice("");
  };

  const onRemove = async () => {
    const pid = normalize(project?.id);
    const uid = normalize(removeEntry?.userId);
    if (!pid || !uid) return;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      await removeProjectMember({ token, projectId: pid, userId: uid });
      setRemoveOpen(false);
      setRemoveEntry(null);
      setNotice("Member removed.");
      toast("Member removed", "success");
      await refresh();
    } catch (e) {
      setError(e?.message || "Remove failed");
    } finally {
      setLoading(false);
    }
  };

  const filteredTemplates = useMemo(() => {
    const q = normalize(formsQuery).toLowerCase();
    const items = Array.isArray(templates) ? templates : [];
    const pdf = items.filter(isPdfTemplate);
    if (!q) return pdf;
    return pdf.filter((t) => String(t?.title || t?.id || "").toLowerCase().includes(q));
  }, [formsQuery, templates]);

  const whoTabs = useMemo(() => {
    const items = [
      { id: "assigned", label: "Assigned to me" },
      { id: "created", label: "Created by me" }
    ];
    if (flowsCanManage) items.push({ id: "all", label: "All requests" });
    return items;
  }, [flowsCanManage]);

  const filteredFlows = useMemo(() => {
    const items = Array.isArray(projectFlows) ? projectFlows : [];
    const who = String(requestsWho || "assigned");
    const byWho =
      who === "all" && flowsCanManage
        ? items
        : who === "created"
          ? items.filter((f) => String(f?.createdByUserId || "") === String(meId || ""))
          : !meEmail
            ? []
            : items.filter((f) => {
                const recipients = Array.isArray(f?.recipientEmails) ? f.recipientEmails : [];
                return recipients.map((e) => String(e || "").trim().toLowerCase()).includes(meEmail);
              });

    const q = normalize(requestsQuery).toLowerCase();
    if (!q) return byWho;
    return byWho.filter((f) => {
      const hay = `${f?.fileTitle || ""} ${f?.templateTitle || ""} ${(Array.isArray(f?.recipientEmails) ? f.recipientEmails.join(" ") : "")}`.toLowerCase();
      return hay.includes(q);
    });
  }, [flowsCanManage, meEmail, meId, projectFlows, requestsQuery, requestsWho]);

  const groupedRequests = useMemo(() => {
    const items = Array.isArray(filteredFlows) ? filteredFlows : [];
    const byId = new Map();
    for (const flow of items) {
      if (!flow?.id) continue;
      const gid = String(flow?.groupId || flow.id).trim() || String(flow.id);
      const existing = byId.get(gid) || { id: gid, flows: [] };
      existing.flows.push(flow);
      byId.set(gid, existing);
    }

    const groups = Array.from(byId.values()).map((g) => {
      const flows = (g.flows || []).slice().sort((a, b) => String(b?.createdAt || "").localeCompare(String(a?.createdAt || "")));
      const first = flows[0] || null;
      const total = flows.length;
      const completed = flows.filter((f) => String(f?.status || "") === "Completed").length;
      const canceled = flows.filter((f) => String(f?.status || "") === "Canceled").length;
      const status =
        total > 0 && completed === total ? "Completed" : total > 0 && canceled === total ? "Canceled" : "InProgress";

      const recipients = Array.from(
        new Set(
          flows
            .flatMap((f) => (Array.isArray(f?.recipientEmails) ? f.recipientEmails : []))
            .map((e) => String(e || "").trim().toLowerCase())
            .filter(Boolean)
        )
      );
      const assignedFlow =
        meEmail && recipients.includes(meEmail)
          ? flows.find((f) => Array.isArray(f?.recipientEmails) && f.recipientEmails.map((x) => String(x || "").trim().toLowerCase()).includes(meEmail)) ||
            null
          : null;
      const primaryFlow = assignedFlow || flows.find((f) => String(f?.status || "") !== "Canceled") || first;

      return {
        id: g.id,
        flows,
        primaryFlow,
        status,
        counts: { total, completed, canceled },
        createdAt: first?.createdAt || null
      };
    });

    groups.sort((a, b) => String(b?.createdAt || "").localeCompare(String(a?.createdAt || "")));
    return groups;
  }, [filteredFlows, meEmail]);

  const tabItems = useMemo(
    () => [
      { id: "requests", label: "Requests" },
      { id: "people", label: "People" }
    ],
    []
  );

  const addFormTabs = useMemo(
    () => [
      { id: "my", label: "My documents" },
      { id: "shared", label: "Shared templates" }
    ],
    []
  );

  const loadAddFormSources = async () => {
    if (!token) return;
    setAddFormLoading(true);
    setAddFormError("");
    try {
      const [draftsRes, sharedRes] = await Promise.all([
        listDrafts({ token }).catch((e) => ({ __error: e })),
        listSharedTemplates({ token }).catch((e) => ({ __error: e }))
      ]);

      if (draftsRes?.__error) {
        throw draftsRes.__error;
      }
      setAddFormMyDocs(Array.isArray(draftsRes?.drafts) ? draftsRes.drafts : []);

      if (sharedRes?.__error) {
        // Shared room might not be configured yet; keep it as an empty list and show error only when user opens that tab.
        setAddFormShared([]);
      } else {
        setAddFormShared(Array.isArray(sharedRes?.templates) ? sharedRes.templates : []);
      }
    } catch (e) {
      setAddFormError(e?.message || "Failed to load forms");
      setAddFormMyDocs([]);
      setAddFormShared([]);
    } finally {
      setAddFormLoading(false);
    }
  };

  const filteredAddForms = useMemo(() => {
    const q = normalize(addFormQuery).toLowerCase();
    const items = addFormSource === "shared" ? addFormShared : addFormMyDocs;
    const pdfOnly = (Array.isArray(items) ? items : []).filter(isPdfTemplate);
    if (!q) return pdfOnly;
    return pdfOnly.filter((t) => String(t?.title || t?.id || "").toLowerCase().includes(q));
  }, [addFormMyDocs, addFormQuery, addFormShared, addFormSource]);

  const openAddForm = async () => {
    setAddFormOpen(true);
    setAddFormSource("my");
    setAddFormQuery("");
    setAddFormSelected(null);
    await loadAddFormSources().catch(() => null);
  };

  const onAddForm = async () => {
    const pid = normalize(project?.id);
    const fileId = normalize(addFormSelected?.id);
    if (!pid || !fileId || !token) return;
    setAddFormLoading(true);
    setAddFormError("");
    setError("");
    setNotice("");
    try {
      await publishDraft({ token, fileId, projectId: pid, destination: "project", activate: true });
      const templatesRes = await listProjectTemplates({ token, projectId: pid }).catch(() => null);
      setTemplates(Array.isArray(templatesRes?.templates) ? templatesRes.templates : []);
      setNotice("Form added to this project.");
      toast("Form added", "success");
      setAddFormOpen(false);
      setAddFormSelected(null);
    } catch (e) {
      setAddFormError(e?.message || "Add form failed");
    } finally {
      setAddFormLoading(false);
    }
  };

  const onOpenCancel = (group) => {
    setCancelEntry(group || null);
    setCancelOpen(true);
    setError("");
    setNotice("");
  };

  const onCancel = async () => {
    const items = Array.isArray(cancelEntry?.flows) ? cancelEntry.flows : [];
    const ids = items.map((f) => normalize(f?.id)).filter(Boolean);
    if (!ids.length) return;
    setCancelBusy(true);
    setError("");
    setNotice("");
    try {
      const failures = [];
      for (const id of ids) {
        // eslint-disable-next-line no-await-in-loop
        await cancelFlow({ token, flowId: id }).catch((e) => failures.push(e));
      }
      if (failures.length) {
        const msg = failures[0]?.message || "Some requests could not be canceled";
        setError(msg);
        toast(msg, "error");
        return;
      }
      setCancelOpen(false);
      setCancelEntry(null);
      setNotice("Request canceled.");
      toast("Request canceled", "success");
      window.dispatchEvent(new CustomEvent("portal:flowsChanged"));
      await refreshFlows();
    } catch (e) {
      setError(e?.message || "Cancel failed");
    } finally {
      setCancelBusy(false);
    }
  };

  const onOpenComplete = (group) => {
    setCompleteEntry(group || null);
    setCompleteOpen(true);
    setError("");
    setNotice("");
  };

  const onComplete = async () => {
    const items = Array.isArray(completeEntry?.flows) ? completeEntry.flows : [];
    const flow = items[0] || null;
    const id = normalize(flow?.id);
    if (!id) return;
    setCompleteBusy(true);
    setError("");
    setNotice("");
    try {
      await completeFlow({ token, flowId: id });
      setCompleteOpen(false);
      setCompleteEntry(null);
      setNotice("Request completed.");
      toast("Request completed", "success");
      window.dispatchEvent(new CustomEvent("portal:flowsChanged"));
      await refreshFlows();
    } catch (e) {
      setError(e?.message || "Complete failed");
    } finally {
      setCompleteBusy(false);
    }
  };

  const groupFromResult = (result) => {
    const flows = Array.isArray(result?.flows) ? result.flows : result?.flow ? [result.flow] : [];
    if (!flows.length) return null;
    const primaryFlow = flows[0] || null;
    const statuses = flows.map((f) => String(f?.status || "")).filter(Boolean);
    const status = statuses.every((s) => s === "Completed")
      ? "Completed"
      : statuses.every((s) => s === "Canceled")
        ? "Canceled"
        : statuses.some((s) => s === "InProgress")
          ? "InProgress"
          : String(primaryFlow?.status || "InProgress");
    const counts = {
      total: flows.length,
      completed: flows.filter((f) => String(f?.status || "") === "Completed").length,
      canceled: flows.filter((f) => String(f?.status || "") === "Canceled").length
    };
    const id =
      normalize(primaryFlow?.groupId || result?.groupId || primaryFlow?.id || result?.id) ||
      normalize(primaryFlow?.id);
    return { id: id || String(Math.random()), flows, primaryFlow, createdAt: primaryFlow?.createdAt || null, status, counts };
  };

  const openFlow = (flow, urlOverride = "") => {
    if (String(flow?.status || "") === "Canceled") return;
    const status = String(flow?.status || "");
    const url = String((status === "Completed" ? flow?.resultFileUrl || urlOverride || flow?.openUrl : urlOverride || flow?.openUrl) || "").trim();
    if (!url) return;
    const kind = String(flow?.kind || "approval").toLowerCase();
    setDocTitle(flow?.fileTitle || flow?.templateTitle || "Document");
    setDocUrl((kind === "fillsign" || kind === "sharedsign") && status !== "Completed" ? withFillAction(url) : url);
    setDocOpen(true);
  };

  const roomTitleById = useMemo(() => {
    const map = new Map();
    const rid = normalize(project?.roomId);
    if (rid) map.set(rid, String(project?.title || "").trim() || "Project");
    return map;
  }, [project?.roomId, project?.title]);

  const onCopyLink = async (url) => {
    const value = String(url || "").trim();
    if (!value) return;
    setError("");
    setNotice("");
    try {
      await navigator.clipboard.writeText(value);
      setNotice("Link copied.");
      toast("Link copied", "success");
    } catch {
      setError("Copy failed. Please copy the link manually.");
    }
  };

  const notifyGroup = async (group, { reminder = false } = {}) => {
    if (!flowsCanManage) return;
    const pid = normalize(project?.id);
    if (!pid || !token) return;

    const flow = group?.primaryFlow || group?.flows?.[0] || null;
    if (!flow) return;

    const stageEmails = Array.from(
      new Set(
        (Array.isArray(group?.flows) ? group.flows : [])
          .filter((f) => String(f?.status || "") === "InProgress")
          .flatMap((f) => (Array.isArray(f?.recipientEmails) ? f.recipientEmails : []))
          .map((e) => String(e || "").trim())
          .filter(Boolean)
      )
    );

    const allEmails = Array.from(
      new Set(
        (Array.isArray(group?.flows) ? group.flows : [])
          .flatMap((f) => (Array.isArray(f?.recipientEmails) ? f.recipientEmails : []))
          .map((e) => String(e || "").trim())
          .filter(Boolean)
      )
    );

    const emails = stageEmails.length ? stageEmails : allEmails;
    if (!emails.length) return;

    const kind = String(flow?.kind || "").toLowerCase();
    const title = flow?.fileTitle || flow?.templateTitle || "Request";
    const portalUrl = typeof window !== "undefined" ? String(window.location?.origin || "").trim() : "";
    const link = String(flow?.openUrl || "").trim();

    const base =
      kind === "fillsign"
        ? `Please fill and sign: ${title}.`
        : kind === "sharedsign"
          ? `Please review and sign: ${title}.`
          : `You have a new approval request: ${title}.`;

    const message = `${reminder ? "Reminder: " : ""}${base}${link ? `\n\nOpen: ${link}` : portalUrl ? `\n\nOpen: ${portalUrl}` : ""}`;

    setError("");
    setNotice("");
    try {
      await inviteProject({
        token,
        projectId: pid,
        emails: emails.join(","),
        access: "FillForms",
        notify: true,
        message
      });
      setNotice(reminder ? "Reminder sent." : "Notification sent.");
      toast(reminder ? "Reminder sent" : "Notification sent", "success");
    } catch (e) {
      setError(e?.message || "Notify failed");
    }
  };

  return (
    <div className="page-shell">
      <header className="topbar">
        <div className="topbar-main">
          <div className="topbar-title-row">
            <h2 className="topbar-title" title={project?.title || ""}>
              {project?.title || "Project"}
            </h2>
            <StatusPill tone={canManageProject ? "blue" : "gray"}>{myRoleLabel}</StatusPill>
          </div>
          <p className="muted">Manage requests, templates, and people for this project.</p>
          {isProjectReadOnly ? <p className="muted" style={{ marginTop: -8 }}>Archived project — read-only view.</p> : null}
        </div>
        <div className="topbar-actions">
          <button type="button" onClick={onBack} disabled={busy || loading}>
            Back
          </button>
          <button
            type="button"
            onClick={() => setTab("templates")}
            disabled={busy || loading || !project?.id || !token}
            title="Templates published to this project"
          >
            Templates
          </button>
          <button type="button" onClick={refresh} disabled={busy || loading}>
            Refresh
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => setInviteOpen(true)}
            disabled={busy || loading || !project?.id || !canManageProject || isProjectReadOnly}
            title={isProjectReadOnly ? "Archived projects are read-only" : ""}
          >
            Invite people
          </button>
          {project?.roomUrl ? (
            <a className="btn" href={project.roomUrl} target="_blank" rel="noreferrer">
              Open room
            </a>
          ) : null}
        </div>
      </header>

      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="notice">{notice}</p> : null}

        <section className="card compact templates-switch">
          <div className="templates-switch-row">
            <Tabs value={tab} onChange={setTab} items={tabItems} ariaLabel="Project view" />
            <input
              value={tab === "people" ? peopleQuery : tab === "requests" ? requestsQuery : formsQuery}
              onChange={(e) =>
                tab === "people"
                  ? setPeopleQuery(e.target.value)
                  : tab === "requests"
                    ? setRequestsQuery(e.target.value)
                    : setFormsQuery(e.target.value)
              }
              placeholder={tab === "people" ? "Search people..." : tab === "requests" ? "Search requests..." : "Search templates..."}
              disabled={busy || loading}
              className="templates-search"
            />
          </div>
        </section>

      {tab === "people" ? (
        <section className="card page-card">
          <div className="card-header compact">
            <div>
              <h3>People</h3>
              <p className="muted">Invite teammates and manage access.</p>
            </div>
            <div className="card-header-actions">
              <span className="muted">{filteredMembers.length} shown</span>
            </div>
          </div>

          <div className="list scroll-area">
            {!normalizedMembers.length ? (
              <EmptyState
                title="No members data"
                description="Invite someone, or open the room to manage access."
              />
            ) : filteredMembers.length === 0 ? (
              <EmptyState title="No matches" description="Try a different search." />
            ) : (
              filteredMembers.map((m) => (
              <div key={m.key} className="list-row">
                <div className="list-main">
                  <strong className="truncate">{m.title}</strong>
                  <span className="muted truncate">
                    {m.subtitle ? `${m.subtitle} - ` : ""}
                    <StatusPill tone={m.isOwner ? "green" : "gray"}>{m.isOwner ? "Project admin" : accessLabel(m.access)}</StatusPill>
                  </span>
                </div>
                <div className="list-actions">
                  {m.type === "user" && !m.isOwner && !isProjectReadOnly ? (
                    <button
                      type="button"
                      className="danger"
                      onClick={() => onOpenRemove(m)}
                      disabled={busy || loading || !canManageProject || !m.canRevoke || m.userId === meId}
                      title={!canManageProject ? "Only the room admin can remove members" : !m.canRevoke ? "No permission to remove this member" : ""}
                    >
                      Remove
                    </button>
                  ) : (
                    <span className="muted" style={{ fontSize: 12 }}>
                      {m.type}
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
        </section>
      ) : tab === "requests" ? (
        <section className="card page-card">
          <div className="card-header compact">
            <div>
              <h3>Requests</h3>
              <p className="muted">Requests in this project.</p>
            </div>
            <div className="card-header-actions">
              <Tabs
                value={requestsWho}
                onChange={(value) => {
                  setRequestsWhoTouched(true);
                  setRequestsWho(value);
                }}
                items={whoTabs}
                ariaLabel="Requests view"
              />
              <span className="muted">{groupedRequests.length} shown</span>
              <button type="button" onClick={refreshFlows} disabled={busy || loading || flowsLoading || !normalize(token)}>
                {flowsLoading ? "Loading..." : "Refresh"}
              </button>
              <label className="inline-check" style={{ marginLeft: 6 }}>
                <input
                  type="checkbox"
                  checked={Boolean(autoRefresh)}
                  onChange={(e) => setAutoRefresh(Boolean(e.target.checked))}
                  disabled={busy || loading || !normalize(token)}
                />
                <span>Auto-refresh</span>
              </label>
            </div>
          </div>

          {flowsError ? <p className="error">{flowsError}</p> : null}

          <div className="list scroll-area">
            {!normalize(token) ? (
              <EmptyState title="Sign in to view requests" description="Log in to load project requests." />
            ) : flowsLoading ? (
              <EmptyState title="Loading requests" description="Just a moment." />
            ) : groupedRequests.length === 0 ? (
              <EmptyState title="No requests yet" description="Create a request from a form template to get started." />
            ) : (
              groupedRequests.map((g) => {
                const f = g.primaryFlow || g.flows?.[0] || {};
                const title = String(f?.fileTitle || f?.templateTitle || "Request").trim();
                const status = String(g?.status || f?.status || "InProgress");
                const kind = String(f?.kind || "approval");
                const baseUrl = String(f?.openUrl || "");
                const openUrl = kind === "fillSign" || kind === "sharedSign" ? withFillAction(baseUrl) : baseUrl;
                const statusTone = status === "Completed" ? "green" : status === "Canceled" ? "red" : status === "InProgress" ? "yellow" : "gray";
                const counts = g?.counts || { total: 1, completed: 0 };
                const meta = counts.total > 1 ? `${counts.completed || 0}/${counts.total} completed` : "";
                const dueDate =
                  String(f?.dueDate || "").trim() ||
                  String((Array.isArray(g?.flows) ? g.flows.find((x) => String(x?.dueDate || "").trim())?.dueDate : "") || "").trim();
                const isOverdue = Boolean(status === "InProgress" && dueDate && /^\d{4}-\d{2}-\d{2}$/.test(dueDate) && dueDate < todayIso);
                const canCancel = flowsCanManage && status === "InProgress" && !isProjectReadOnly;
                const recipients = Array.isArray(f?.recipientEmails) ? f.recipientEmails : [];
                const isAssigned = meEmail && recipients.map((e) => String(e || "").trim().toLowerCase()).includes(meEmail);
                const recipientsLabel = formatRecipients(recipients);
                const canComplete =
                  normalizeKind(f?.kind) === "sharedSign" &&
                  status !== "Completed" &&
                  status !== "Canceled" &&
                  (flowsCanManage || isAssigned) &&
                  !isProjectReadOnly;

                return (
                  <div key={g.id} className="list-row">
                    <div className="list-main">
                      <strong className="truncate">{title}</strong>
                      <span className="muted truncate">
                        <StatusPill tone={statusTone}>{status === "InProgress" ? "In progress" : status}</StatusPill>{" "}
                        {meta ? <StatusPill tone="gray">{meta}</StatusPill> : null}{" "}
                        {kind === "fillSign" ? <StatusPill tone="blue">Fill & Sign</StatusPill> : null}
                        {dueDate ? <StatusPill tone={isOverdue ? "red" : "gray"}>{isOverdue ? `Overdue: ${dueDate}` : `Due: ${dueDate}`}</StatusPill> : null}
                        {recipientsLabel.count ? (
                          <StatusPill tone="gray" title={recipientsLabel.full} style={{ marginLeft: 6 }}>
                            Recipients: {recipientsLabel.count}
                          </StatusPill>
                        ) : null}
                      </span>
                    </div>
                    <div className="list-actions">
                      <button
                        type="button"
                        className="primary"
                        disabled={!openUrl || status === "Canceled"}
                        onClick={() => openFlow(f, openUrl)}
                      >
                        {status === "Completed" ? "Open result" : "Open"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDetailsGroup(g);
                          setDetailsOpen(true);
                        }}
                        disabled={busy || loading}
                      >
                        Details
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setAuditFlow(f);
                          setAuditOpen(true);
                        }}
                        disabled={busy || loading || !f?.id}
                      >
                        Activity
                      </button>
                      {canComplete ? (
                        <button type="button" onClick={() => onOpenComplete(g)} disabled={busy || loading || completeBusy}>
                          Complete
                        </button>
                      ) : null}
                      {canCancel ? (
                        <button type="button" className="danger" onClick={() => onOpenCancel(g)} disabled={busy || loading || cancelBusy}>
                          Cancel
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      ) : tab === "templates" ? (
        <section className="card page-card">
          <div className="card-header compact">
            <div>
              <h3>Project templates</h3>
              <p className="muted">Templates published to this project.</p>
            </div>
            <div className="card-header-actions">
              {typeof onOpenDrafts === "function" ? (
                <button type="button" onClick={onOpenDrafts} disabled={busy || loading}>
                  Open library
                </button>
              ) : null}
              <span className="muted">{filteredTemplates.length} shown</span>
              <button
                type="button"
                className="primary"
                onClick={openAddForm}
                disabled={busy || loading || !token || !project?.id || !canManageProject || isProjectReadOnly}
                title={isProjectReadOnly ? "Archived projects are read-only" : !canManageProject ? "Only the project admin can add templates" : ""}
              >
                Add template
              </button>
            </div>
          </div>

          <div className="list scroll-area">
            {!filteredTemplates.length ? (
              <EmptyState
                title="No templates found"
                description="Publish a template to this project to make it available here."
                actions={
                  typeof onOpenDrafts === "function" ? (
                    <button type="button" className="primary" onClick={onOpenDrafts} disabled={busy || loading}>
                      Open library
                    </button>
                  ) : null
                }
              />
            ) : (
              filteredTemplates.map((t) => (
              <div key={t.id} className="list-row">
                <div className="list-main">
                  <strong className="truncate">{t.title || `File ${t.id}`}</strong>
                  <span className="muted truncate">
                    <StatusPill tone={t.isForm ? "green" : "gray"}>{t.isForm ? "Form" : "File"}</StatusPill>
                  </span>
                </div>
                <div className="list-actions">
                  <button
                    type="button"
                    className="primary"
                    onClick={async () => {
                      setCreatingTemplateId(String(t?.id || ""));
                      const pid = normalize(project?.id || projectId);
                      if (!pid || !token || typeof onStartFlow !== "function") return;
                      setError("");
                      setNotice("");
                      try {
                        const result = await onStartFlow(t.id, pid);
                        if (!result) {
                          toast("Request creation failed\nPlease check Settings and try again.", "error");
                          return;
                        }
                        const group = groupFromResult(result);
                        setTab("requests");
                        if (group) {
                          setDetailsGroup(group);
                          setDetailsOpen(true);
                        }
                        refreshFlows().catch(() => null);
                      } finally {
                        setCreatingTemplateId("");
                      }
                    }}
                    disabled={busy || loading || !token || String(creatingTemplateId) === String(t?.id || "")}
                  >
                    {String(creatingTemplateId) === String(t?.id || "") ? "Creating..." : "Create request"}
                  </button>
                  {t.webUrl ? (
                    <a className="btn" href={t.webUrl} target="_blank" rel="noreferrer">
                      Open in new tab
                    </a>
                  ) : null}
                  {canManageProject ? (
                    <button
                      type="button"
                      className="danger"
                      onClick={() => {
                        setRemoveTemplateEntry(t);
                        setRemoveTemplateOpen(true);
                      }}
                      disabled={busy || loading || isProjectReadOnly}
                      title="Remove this template from the current project"
                    >
                      Unpublish
                    </button>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
        </section>
      ) : null}

      <Modal
        open={inviteOpen}
        title={project?.title ? `Invite to ${project.title}` : "Invite"}
        onClose={() => {
          if (loading) return;
          setInviteOpen(false);
        }}
        footer={
          <>
            <button type="button" onClick={() => setInviteOpen(false)} disabled={busy || loading}>
              Cancel
            </button>
            <button
              type="button"
              className="primary"
              onClick={onInvite}
              disabled={busy || loading || !normalize(invite.emails) || !project?.id || !canManageProject}
            >
              {loading ? "Loading..." : "Send invites"}
            </button>
          </>
        }
      >
        {!canManageProject ? (
          <p className="muted" style={{ margin: "0 0 10px" }}>
            Only the room admin can invite people to this project.
          </p>
        ) : null}
        <form className="auth-form" onSubmit={(e) => e.preventDefault()} style={{ marginTop: 0 }}>
          <label>
            <span>Emails</span>
            <EmailChipsInput
              value={invite.emails}
              onChange={(next) => setInvite((s) => ({ ...s, emails: next }))}
              placeholder="Type an email and press Enter"
              disabled={busy || loading || !canManageProject}
            />
          </label>
          <label>
            <span>Role</span>
            <select value={invite.access} onChange={(e) => setInvite((s) => ({ ...s, access: e.target.value }))}>
              <option value="FillForms">Form respondent</option>
              <option value="Read">Project viewer</option>
              <option value="ReadWrite">Project editor</option>
              <option value="RoomManager">Project admin</option>
            </select>
          </label>
          <label>
            <span>
              <input type="checkbox" checked={Boolean(invite.notify)} onChange={(e) => setInvite((s) => ({ ...s, notify: e.target.checked }))} />{" "}
              Send notifications
            </span>
          </label>
          <label>
            <span>Message (optional)</span>
            <input value={invite.message} onChange={(e) => setInvite((s) => ({ ...s, message: e.target.value }))} />
          </label>
        </form>
      </Modal>

      <Modal
        open={addFormOpen}
        title="Add form to project"
        onClose={() => {
          if (addFormLoading) return;
          setAddFormOpen(false);
        }}
        footer={
          <>
            <button type="button" onClick={() => setAddFormOpen(false)} disabled={busy || loading || addFormLoading}>
              Cancel
            </button>
            <button
              type="button"
              className="primary"
              onClick={onAddForm}
              disabled={busy || loading || addFormLoading || !addFormSelected?.id || !canManageProject}
              title={!canManageProject ? "Only the project admin can add forms" : ""}
            >
              {addFormLoading ? "Loading..." : "Add to project"}
            </button>
          </>
        }
      >
        <div className="request-wizard" style={{ gap: 12 }}>
          <div className="wizard-section">
            <div className="wizard-head">
              <strong>Source</strong>
              <span className="muted">Pick a PDF file.</span>
            </div>
            <Tabs value={addFormSource} onChange={(v) => setAddFormSource(v)} items={addFormTabs} ariaLabel="Form source" />
          </div>

          <div className="wizard-section">
            <div className="auth-form" style={{ marginTop: 0 }}>
              <label>
                <span>Search</span>
                <input
                  value={addFormQuery}
                  onChange={(e) => setAddFormQuery(e.target.value)}
                  placeholder={addFormSource === "shared" ? "Search shared templates..." : "Search My documents..."}
                  disabled={busy || loading || addFormLoading}
                />
              </label>
            </div>

            {addFormError ? <p className="error" style={{ margin: 0 }}>{addFormError}</p> : null}

            {addFormLoading ? (
              <EmptyState title="Loading..." description="Just a moment." />
            ) : addFormSource === "shared" && addFormShared.length === 0 ? (
              <EmptyState
                title="No shared templates"
                description="Publish a PDF to the shared templates room first (Templates page), then add it to this project."
              />
            ) : filteredAddForms.length === 0 ? (
              <EmptyState title="No forms found" description="Try a different search." />
            ) : (
              <div className="list" style={{ marginTop: 0 }}>
                {filteredAddForms.slice(0, 12).map((t) => {
                  const selected = String(addFormSelected?.id || "") === String(t.id || "");
                  return (
                    <button
                      key={t.id}
                      type="button"
                      className={`select-row${selected ? " is-selected" : ""}`}
                      onClick={() => setAddFormSelected(t)}
                      disabled={busy || loading || addFormLoading}
                    >
                      <div className="select-row-main">
                        <strong className="truncate">{t.title || `File ${t.id}`}</strong>
                      </div>
                      <span className="select-row-right" aria-hidden="true">{selected ? "Selected" : ">"}</span>
                    </button>
                  );
                })}
              </div>
            )}

            <p className="muted" style={{ margin: 0 }}>
              Copies the PDF into this project’s Forms folder.
            </p>
          </div>
        </div>
      </Modal>

      <Modal
        open={completeOpen}
        title="Mark as complete?"
        onClose={() => {
          if (completeBusy) return;
          setCompleteOpen(false);
        }}
        footer={
          <>
            <button type="button" onClick={() => setCompleteOpen(false)} disabled={busy || loading || completeBusy}>
              Cancel
            </button>
            <button
              type="button"
              className="primary"
              onClick={onComplete}
              disabled={busy || loading || completeBusy || !(Array.isArray(completeEntry?.flows) && completeEntry.flows.length)}
            >
              {completeBusy ? "Loading..." : "Complete"}
            </button>
          </>
        }
      >
        <EmptyState title="This will mark the request as completed in the portal." description="Use this when the shared signing is done." />
      </Modal>

      <Modal
        open={cancelOpen}
        title="Cancel request?"
        onClose={() => {
          if (cancelBusy) return;
          setCancelOpen(false);
        }}
        footer={
          <>
            <button type="button" onClick={() => setCancelOpen(false)} disabled={busy || loading || cancelBusy}>
              Keep
            </button>
            <button
              type="button"
              className="danger"
              onClick={onCancel}
              disabled={busy || loading || cancelBusy || !(Array.isArray(cancelEntry?.flows) && cancelEntry.flows.length)}
            >
              {cancelBusy ? "Loading..." : "Cancel request"}
            </button>
          </>
        }
      >
        <EmptyState title="This will stop the request in the portal." description="It will not delete any files." />
      </Modal>

      <Modal
        open={removeOpen}
        title={removeEntry?.title ? `Remove ${removeEntry.title}?` : "Remove member?"}
        onClose={() => {
          if (loading) return;
          setRemoveOpen(false);
        }}
        footer={
          <>
            <button type="button" onClick={() => setRemoveOpen(false)} disabled={busy || loading}>
              Cancel
            </button>
            <button type="button" className="danger" onClick={onRemove} disabled={busy || loading || !removeEntry?.userId || !canManageProject}>
              {loading ? "Loading..." : "Remove"}
            </button>
          </>
        }
      >
        <EmptyState title="This revokes access to the project room." description="The user can be re-invited later." />
      </Modal>

      <Modal
        open={removeTemplateOpen}
        title={removeTemplateEntry?.title ? `Unpublish "${removeTemplateEntry.title}"?` : "Unpublish template?"}
        onClose={() => {
          if (removeTemplateBusy) return;
          setRemoveTemplateOpen(false);
          setRemoveTemplateEntry(null);
        }}
        footer={
          <>
            <button
              type="button"
              onClick={() => {
                setRemoveTemplateOpen(false);
                setRemoveTemplateEntry(null);
              }}
              disabled={busy || loading || removeTemplateBusy}
            >
              Keep
            </button>
            <button
              type="button"
              className="danger"
              onClick={async () => {
                const fid = normalize(removeTemplateEntry?.id);
                if (!fid) return;
                setRemoveTemplateBusy(true);
                setError("");
                setNotice("");
                try {
                  if (!token) throw new Error("Authorization token is required");
                  const pid = normalize(project?.id || projectId);
                  if (!pid) throw new Error("projectId is required");
                  await deleteProjectTemplateFromProject({ token, projectId: pid, fileId: fid });
                  const templatesRes = await listProjectTemplates({ token, projectId: pid }).catch(() => null);
                  setTemplates(Array.isArray(templatesRes?.templates) ? templatesRes.templates : []);
                  setRemoveTemplateOpen(false);
                  setRemoveTemplateEntry(null);
                  setNotice("Template unpublished from this project.");
                  toast("Template unpublished", "success");
                } catch (e) {
                  const msg = e?.message || "Unpublish failed";
                  setError(msg);
                  toast(msg, "error");
                } finally {
                  setRemoveTemplateBusy(false);
                }
              }}
              disabled={busy || loading || removeTemplateBusy || !removeTemplateEntry?.id || !canManageProject}
              title={!canManageProject ? "Only the project admin can unpublish templates" : ""}
            >
              {removeTemplateBusy ? "Loading..." : "Unpublish"}
            </button>
          </>
        }
      >
        <EmptyState
          title="This removes the file from this project's Templates folder."
          description="It does not delete your original draft in My documents."
        />
      </Modal>

      <RequestDetailsModal
        open={detailsOpen}
        onClose={() => {
          setDetailsOpen(false);
          setDetailsGroup(null);
        }}
        busy={busy || loading || cancelBusy || completeBusy}
        group={detailsGroup}
        roomTitleById={roomTitleById}
        onOpen={(flow) => {
          setDetailsOpen(false);
          openFlow(flow);
        }}
        onCopyLink={(url) => onCopyLink(url)}
        onNotify={flowsCanManage ? (group) => notifyGroup(group, { reminder: false }) : null}
        onRemind={flowsCanManage ? (group) => notifyGroup(group, { reminder: true }) : null}
        onActivity={(flow) => {
          if (!flow?.id) return;
          setDetailsOpen(false);
          setAuditFlow(flow);
          setAuditOpen(true);
        }}
        onCancel={(group) => {
          setDetailsOpen(false);
          onOpenCancel(group);
        }}
        onComplete={() => {
          if (!detailsGroup) return;
          setDetailsOpen(false);
          onOpenComplete(detailsGroup);
        }}
        canCancel={(() => {
          const f = detailsGroup?.primaryFlow || detailsGroup?.flows?.[0] || null;
          const status = String(detailsGroup?.status || f?.status || "");
          return Boolean(flowsCanManage && status === "InProgress");
        })()}
        canComplete={(() => {
          const f = detailsGroup?.primaryFlow || detailsGroup?.flows?.[0] || null;
          const status = String(detailsGroup?.status || f?.status || "");
          const kind = String(f?.kind || "").toLowerCase();
          const recipients = Array.isArray(f?.recipientEmails) ? f.recipientEmails : [];
          const isAssigned = meEmail && recipients.map((e) => String(e || "").trim().toLowerCase()).includes(meEmail);
          return Boolean(kind === "sharedsign" && status !== "Completed" && status !== "Canceled" && (flowsCanManage || isAssigned));
        })()}
      />

      <DocSpaceModal open={docOpen} title={docTitle} url={docUrl} onClose={() => setDocOpen(false)} />

      <AuditModal
        open={auditOpen}
        onClose={() => {
          setAuditOpen(false);
          setAuditFlow(null);
        }}
        token={token}
        flowId={auditFlow?.id}
        title={auditFlow?.fileTitle || auditFlow?.templateTitle ? `Activity — ${auditFlow?.fileTitle || auditFlow?.templateTitle}` : "Activity"}
      />
    </div>
  );
}
