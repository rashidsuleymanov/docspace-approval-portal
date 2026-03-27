import { useCallback, useEffect, useMemo, useState } from "react";
import DocSpaceModal from "../components/DocSpaceModal.jsx";
import AuditModal from "../components/AuditModal.jsx";
import ContextMenu from "../components/ContextMenu.jsx";
import EmptyState from "../components/EmptyState.jsx";
import EmailChipsInput from "../components/EmailChipsInput.jsx";
import Modal from "../components/Modal.jsx";
import RequestDetailsModal from "../components/RequestDetailsModal.jsx";
import StatusPill from "../components/StatusPill.jsx";
import Tabs from "../components/Tabs.jsx";
import { toast } from "../utils/toast.js";
import {
  archiveFlow,
  cancelFlow,
  completeFlow,
  getDirectoryGroup,
  deleteFlowPermanently,
  getProjectMembers,
  getProjectsPermissions,
  inviteProject,
  listDirectoryGroups,
  listDirectoryPeople,
  listFlows,
  reopenFlow,
  searchDirectoryPeople,
  trashFlow,
  unarchiveFlow,
  untrashFlow
} from "../services/portalApi.js";
import { listLocalDrafts, saveLocalDraft } from "../services/draftsStore.js";

function isPdfTemplate(t) {
  const ext = String(t?.fileExst || "").trim().toLowerCase();
  const title = String(t?.title || "").trim().toLowerCase();
  return ext === "pdf" || ext === ".pdf" || title.endsWith(".pdf");
}

function normalizeEmailList(value) {
  const raw = String(value || "");
  const parts = raw.split(/[\n,;]+/g).map((s) => s.trim()).filter(Boolean);
  const uniq = new Set();
  for (const p of parts) uniq.add(p);
  return Array.from(uniq);
}

function mergeEmailSets(...parts) {
  const out = new Set();
  for (const p of parts) {
    const arr = Array.isArray(p) ? p : p instanceof Set ? Array.from(p) : [];
    for (const e of arr) {
      const email = String(e || "").trim().toLowerCase();
      if (email) out.add(email);
    }
  }
  return Array.from(out);
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

function normalizeKind(value) {
  const v = String(value || "").trim().toLowerCase();
  if (v === "fillsign" || v === "fill-sign" || v === "fill_sign" || v === "sign") return "fillSign";
  if (v === "sharedsign" || v === "shared-sign" || v === "shared_sign" || v === "contract") return "sharedSign";
  return "approval";
}

export default function Requests({
  session,
  busy,
  error,
  flows,
  flowsRefreshing = false,
  flowsUpdatedAt = null,
  onRefreshFlows,
  activeRoomId,
  activeProject,
  projects = [],
  templates,
  initialFilter = "all",
  initialScope = "all",
  onBack,
  onStartFlow,
  onOpenDrafts,
  onOpenProjects
}) {
  const token = String(session?.token || "").trim();
  const meId = session?.user?.id ? String(session.user.id) : "";
  const meEmail = session?.user?.email ? String(session.user.email).trim().toLowerCase() : "";
  const hasAnyProjects = Array.isArray(projects) && projects.length > 0;
  const updatedLabel = flowsUpdatedAt instanceof Date ? flowsUpdatedAt.toLocaleTimeString() : "";
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const isOverdueFlow = useCallback((flow) => {
    const due = String(flow?.dueDate || "").trim();
    if (!due || !/^\d{4}-\d{2}-\d{2}$/.test(due)) return false;
    const status = String(flow?.status || "");
    if (status !== "InProgress") return false;
    return due < todayIso;
  }, [todayIso]);

  const [localError, setLocalError] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkMode, setBulkMode] = useState("archive"); // archive | restore
  const [bulkCandidates, setBulkCandidates] = useState([]);

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState(String(initialFilter || "inProgress"));
  const [scope, setScope] = useState(String(initialScope || "current"));
  const [who, setWho] = useState("all");
  const [archivedFlows, setArchivedFlows] = useState([]);
  const [archivedRefreshing, setArchivedRefreshing] = useState(false);
  const [archivedError, setArchivedError] = useState("");
  const [trashedFlows, setTrashedFlows] = useState([]);
  const [trashedRefreshing, setTrashedRefreshing] = useState(false);
  const [trashedError, setTrashedError] = useState("");
  const [sendOpen, setSendOpen] = useState(false);
  const [sendQuery, setSendQuery] = useState("");
  const [sendSelectedId, setSendSelectedId] = useState("");
  const [sendSelectedTitle, setSendSelectedTitle] = useState("");
  const [sendFlow, setSendFlow] = useState(null);
  const [sendFlows, setSendFlows] = useState([]);
  const [sendKind, setSendKind] = useState("approval");
  const [sendDueDate, setSendDueDate] = useState("");
  const [sendWarning, setSendWarning] = useState("");
  const [sendStep, setSendStep] = useState("setup"); // setup | recipients
  const [sendAdvanced, setSendAdvanced] = useState(false);
  const [memberQuery, setMemberQuery] = useState("");
  const [orderEnabled, setOrderEnabled] = useState(false);
  const [orderMap, setOrderMap] = useState({});
  const [orderMaxStep, setOrderMaxStep] = useState(2);
  const [sendDraftAvailable, setSendDraftAvailable] = useState(false);
  const [activeDraftId, setActiveDraftId] = useState("");
  // Drafts are stored locally in this browser (see draftsStore).
  const [sendExitConfirmOpen, setSendExitConfirmOpen] = useState(false);

  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState("");
  const [members, setMembers] = useState([]);
  const [projectPerms, setProjectPerms] = useState({});
  const [permsLoaded, setPermsLoaded] = useState(false);

  const [pickedMemberIds, setPickedMemberIds] = useState(() => new Set());
  const [inviteEmails, setInviteEmails] = useState("");
  const [notify, setNotify] = useState(true);
  const [notifyMessage, setNotifyMessage] = useState("");
  const [notifyBusy, setNotifyBusy] = useState(false);
  const [dirMode, setDirMode] = useState("people"); // people | groups
  const [dirPeopleQuery, setDirPeopleQuery] = useState("");
  const [dirPeople, setDirPeople] = useState([]);
  const [dirPeopleTotal, setDirPeopleTotal] = useState(0);
  const [dirGroups, setDirGroups] = useState([]);
  const [dirGroupQuery, setDirGroupQuery] = useState("");
  const [dirSelectedGroupIds, setDirSelectedGroupIds] = useState(() => new Set());
  const [dirGroupMembersById, setDirGroupMembersById] = useState({});
  const [dirGroupLoadingIds, setDirGroupLoadingIds] = useState(() => new Set());
  const [pickedDirectoryEmails, setPickedDirectoryEmails] = useState(() => new Set());
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryError, setDirectoryError] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState("Document");
  const [modalUrl, setModalUrl] = useState("");

  const [actionsOpen, setActionsOpen] = useState(false);
  const [actionsGroup, setActionsGroup] = useState(null);
  const [actionsAnchorEl, setActionsAnchorEl] = useState(null);
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsGroup, setDetailsGroup] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const hasProject = Boolean(String(activeRoomId || "").trim());
  const projectTitle = activeProject?.title || "";
  const projectId = activeProject?.id ? String(activeProject.id) : "";

  const sendHasUnsavedChanges = useMemo(() => {
    if (!sendOpen) return false;
    if (Array.isArray(sendFlows) && sendFlows.length) return false;
    const hasTemplate = Boolean(String(sendSelectedId || "").trim());
    const hasRecipients = Boolean(String(inviteEmails || "").trim()) || (pickedMemberIds instanceof Set ? pickedMemberIds.size > 0 : false) || (pickedDirectoryEmails instanceof Set ? pickedDirectoryEmails.size > 0 : false);
    const hasOther = Boolean(String(sendDueDate || "").trim()) || Boolean(String(notifyMessage || "").trim()) || Boolean(orderEnabled) || Boolean(String(activeDraftId || "").trim());
    return hasTemplate || hasRecipients || hasOther;
  }, [activeDraftId, inviteEmails, notifyMessage, orderEnabled, pickedDirectoryEmails, pickedMemberIds, sendDueDate, sendFlows, sendOpen, sendSelectedId]);

  const requestCloseSend = useCallback(() => {
    if (busy || notifyBusy) return;
    if (sendHasUnsavedChanges) {
      setSendExitConfirmOpen(true);
      return;
    }
    setSendOpen(false);
  }, [busy, notifyBusy, sendHasUnsavedChanges]);

  const closeActionsMenu = useCallback(() => {
    setActionsMenuOpen(false);
    setActionsAnchorEl(null);
  }, []);

  useEffect(() => {
    if (!token || permsLoaded) return;
    getProjectsPermissions({ token })
      .catch(() => null)
      .then((permsRes) => {
        setProjectPerms(permsRes?.permissions && typeof permsRes.permissions === "object" ? permsRes.permissions : {});
      })
      .finally(() => setPermsLoaded(true));
  }, [permsLoaded, token]);

  useEffect(() => {
    setStatusFilter(String(initialFilter || "all"));
  }, [initialFilter]);

  useEffect(() => {
    setScope(String(initialScope || "all"));
  }, [initialScope]);

  useEffect(() => {
    if (statusFilter !== "archived") return;
    if (!token) return;
    setArchivedRefreshing(true);
    setArchivedError("");
    listFlows({ token, archivedOnly: true })
      .then((data) => setArchivedFlows(Array.isArray(data?.flows) ? data.flows : []))
      .catch((e) => {
        setArchivedFlows([]);
        setArchivedError(e?.message || "Failed to load archived requests");
      })
      .finally(() => setArchivedRefreshing(false));
  }, [statusFilter, token]);

  useEffect(() => {
    if (statusFilter !== "archived") return;
    const handler = () => {
      if (!token) return;
      setArchivedRefreshing(true);
      setArchivedError("");
      listFlows({ token, archivedOnly: true })
        .then((data) => setArchivedFlows(Array.isArray(data?.flows) ? data.flows : []))
        .catch((e) => {
          setArchivedFlows([]);
          setArchivedError(e?.message || "Failed to load archived requests");
        })
        .finally(() => setArchivedRefreshing(false));
    };
    window.addEventListener("portal:flowsChanged", handler);
    return () => window.removeEventListener("portal:flowsChanged", handler);
  }, [statusFilter, token]);

  useEffect(() => {
    if (statusFilter !== "trash") return;
    if (!token) return;
    setTrashedRefreshing(true);
    setTrashedError("");
    listFlows({ token, trashedOnly: true })
      .then((data) => setTrashedFlows(Array.isArray(data?.flows) ? data.flows : []))
      .catch((e) => {
        setTrashedFlows([]);
        setTrashedError(e?.message || "Failed to load trash");
      })
      .finally(() => setTrashedRefreshing(false));
  }, [statusFilter, token]);

  useEffect(() => {
    if (statusFilter !== "trash") return;
    const handler = () => {
      if (!token) return;
      setTrashedRefreshing(true);
      setTrashedError("");
      listFlows({ token, trashedOnly: true })
        .then((data) => setTrashedFlows(Array.isArray(data?.flows) ? data.flows : []))
        .catch((e) => {
          setTrashedFlows([]);
          setTrashedError(e?.message || "Failed to load trash");
        })
        .finally(() => setTrashedRefreshing(false));
    };
    window.addEventListener("portal:flowsChanged", handler);
    return () => window.removeEventListener("portal:flowsChanged", handler);
  }, [statusFilter, token]);

  const flowsSource = statusFilter === "archived" ? archivedFlows : statusFilter === "trash" ? trashedFlows : flows;

  const filteredByScope = useMemo(() => {
    const items = Array.isArray(flowsSource) ? flowsSource : [];
    if (scope !== "current") return items;
    const rid = String(activeRoomId || "").trim();
    if (!rid) return [];
    return items.filter((f) => String(f?.projectRoomId || "") === rid);
  }, [activeRoomId, flowsSource, scope]);

  const filteredByWho = useMemo(() => {
    const items = filteredByScope;
    if (who === "all") return items;
    if (who === "created") return items.filter((f) => String(f?.createdByUserId || "") === String(meId || ""));
    // assigned
    if (!meEmail) return [];
    return items.filter((f) => {
      const recipients = Array.isArray(f?.recipientEmails) ? f.recipientEmails : [];
      return recipients.map((e) => String(e || "").trim().toLowerCase()).includes(meEmail);
    });
  }, [filteredByScope, meEmail, meId, who]);

  const roomTitleById = useMemo(() => {
    const list = Array.isArray(projects) ? projects : [];
    const map = new Map();
    for (const p of list) {
      const rid = String(p?.roomId || "").trim();
      if (!rid) continue;
      map.set(rid, String(p?.title || "").trim() || "Project");
    }
    return map;
  }, [projects]);

  const projectIdByRoomId = useMemo(() => {
    const list = Array.isArray(projects) ? projects : [];
    const map = new Map();
    for (const p of list) {
      const rid = String(p?.roomId || "").trim();
      const pid = String(p?.id || "").trim();
      if (!rid || !pid) continue;
      map.set(rid, pid);
    }
    return map;
  }, [projects]);

  const grouped = useMemo(() => {
    const items = filteredByWho;
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
        projectRoomId: first?.projectRoomId || null,
        createdAt: first?.createdAt || null
      };
    });

    groups.sort((a, b) => String(b?.createdAt || "").localeCompare(String(a?.createdAt || "")));
    return groups;
  }, [filteredByWho, meEmail]);

  useEffect(() => {
    if (!autoRefresh) return;
    if (!token) return;
    const hasActive = grouped.some((g) => String(g?.status || "") === "InProgress");
    if (!hasActive) return;

    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      if (busy || flowsRefreshing) return;
      if (typeof onRefreshFlows === "function") onRefreshFlows();
    }, 25000);

    return () => clearInterval(id);
  }, [autoRefresh, busy, flowsRefreshing, grouped, onRefreshFlows, token]);

  const filteredGroups = useMemo(() => {
    const q = String(query || "").trim().toLowerCase();
    const byStatus =
      statusFilter === "archived"
        ? grouped.filter((g) => (Array.isArray(g?.flows) ? g.flows : []).some((f) => Boolean(f?.archivedAt)))
        : statusFilter === "trash"
          ? grouped
        : statusFilter === "links"
          ? grouped.filter((g) =>
              (Array.isArray(g?.flows) ? g.flows : []).some((f) => String(f?.source || "") === "bulkLink")
            )
        : statusFilter === "inProgress"
        ? grouped.filter((g) => g.status === "InProgress")
        : statusFilter === "completed"
          ? grouped.filter((g) => g.status === "Completed")
          : statusFilter === "overdue"
            ? grouped.filter((g) => (Array.isArray(g.flows) ? g.flows : []).some((f) => isOverdueFlow(f)))
          : statusFilter === "other"
            ? grouped.filter((g) => g.status !== "InProgress" && g.status !== "Completed")
            : grouped;
    if (!q) return byStatus;
    return byStatus.filter((g) => {
      const flow = g.primaryFlow || g.flows?.[0] || {};
      const recipients = g.flows
        ? Array.from(
            new Set(
              g.flows
                .flatMap((f) => (Array.isArray(f?.recipientEmails) ? f.recipientEmails : []))
                .map((e) => String(e || "").trim().toLowerCase())
                .filter(Boolean)
            )
          )
        : [];
      const hay = `${flow.fileTitle || flow.templateTitle || flow.templateFileId || ""} ${recipients.join(" ")}`.toLowerCase();
      return hay.includes(q);
    });
  }, [grouped, isOverdueFlow, query, statusFilter]);

  const scopeTabs = useMemo(
    () => [
      { id: "all", label: "All projects" },
      { id: "current", label: "Current project", disabled: !hasProject }
    ],
    [hasProject]
  );

  const whoTabs = useMemo(
    () => [
      { id: "assigned", label: "Assigned to me" },
      { id: "created", label: "Created by me" },
      { id: "all", label: "All" }
    ],
    []
  );

  const templateItems = Array.isArray(templates) ? templates : [];
  const filteredSendTemplates = useMemo(() => {
    const q = String(sendQuery || "").trim().toLowerCase();
    const pdfOnly = templateItems.filter(isPdfTemplate);
    if (!q) return pdfOnly;
    return pdfOnly.filter((t) => String(t.title || t.id || "").toLowerCase().includes(q));
  }, [sendQuery, templateItems]);

  const projectMembers = useMemo(() => {
    const items = Array.isArray(members) ? members : [];
    return items
      .filter((m) => m?.user?.id && (m?.user?.email || m?.user?.displayName))
      .map((m) => ({
        id: String(m.user.id),
        name: String(m.user.displayName || m.user.email || "User").trim(),
        email: String(m.user.email || "").trim(),
        isOwner: Boolean(m?.isOwner)
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [members]);

  const filteredProjectMembers = useMemo(() => {
    const q = String(memberQuery || "").trim().toLowerCase();
    if (!q) return projectMembers;
    return projectMembers.filter((m) => {
      const hay = `${m.name || ""} ${m.email || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [memberQuery, projectMembers]);

  const canManageProject = useMemo(() => {
    if (!projectId) return false;
    return Boolean(projectPerms?.[String(projectId)]);
  }, [projectId, projectPerms]);

  const selectedMemberEmails = useMemo(() => {
    const set = pickedMemberIds instanceof Set ? pickedMemberIds : new Set();
    const list = projectMembers.filter((m) => set.has(m.id) && m.email).map((m) => m.email);
    const uniq = new Set(list);
    return Array.from(uniq);
  }, [pickedMemberIds, projectMembers]);

  const filteredDirGroups = useMemo(() => {
    const list = Array.isArray(dirGroups) ? dirGroups : [];
    const q = String(dirGroupQuery || "").trim().toLowerCase();
    const filtered = q ? list.filter((g) => String(g?.name || "").toLowerCase().includes(q)) : list.slice();
    filtered.sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || "")));
    return filtered;
  }, [dirGroupQuery, dirGroups]);

  const directoryRows = useMemo(() => {
    const list =
      dirMode === "groups"
        ? Array.from(dirSelectedGroupIds).flatMap((gid) => (Array.isArray(dirGroupMembersById?.[gid]) ? dirGroupMembersById[gid] : []))
        : dirPeople;
    const items = Array.isArray(list) ? list : [];

    const normalized = items
      .map((p) => ({
        email: String(p?.email || "").trim().toLowerCase(),
        name: String(p?.displayName || p?.name || "").trim()
      }))
      .filter((p) => p.email);

    const seen = new Set();
    const uniq = [];
    for (const row of normalized) {
      if (seen.has(row.email)) continue;
      seen.add(row.email);
      uniq.push(row);
    }
    return uniq;
  }, [dirGroupMembersById, dirMode, dirPeople, dirSelectedGroupIds]);

  const allRecipientEmails = useMemo(() => {
    const fromPick = selectedMemberEmails;
    const fromInvite = normalizeEmailList(inviteEmails);
    const fromDirectory = pickedDirectoryEmails instanceof Set ? Array.from(pickedDirectoryEmails) : [];
    return mergeEmailSets(fromPick, fromInvite, fromDirectory);
  }, [inviteEmails, pickedDirectoryEmails, selectedMemberEmails]);

  const toggleDirectoryGroup = useCallback((groupId) => {
    const gid = String(groupId || "").trim();
    if (!gid) return;

    setDirSelectedGroupIds((prev) => {
      const next = new Set(prev instanceof Set ? prev : []);
      if (next.has(gid)) next.delete(gid);
      else next.add(gid);
      return next;
    });
  }, []);

  const refreshSendDraftAvailable = useCallback(() => {
    try {
      const list = listLocalDrafts(session);
      setSendDraftAvailable(list.length > 0);
    } catch {
      setSendDraftAvailable(false);
    }
  }, [session]);

  const saveSendDraft = useCallback(() => {
    try {
      const payload = {
        v: 1,
        kind: sendKind,
        templateId: sendSelectedId,
        templateTitle: sendSelectedTitle,
        dueDate: sendDueDate || "",
        recipients: allRecipientEmails,
        notify: Boolean(notify),
        message: String(notifyMessage || ""),
        orderEnabled: Boolean(orderEnabled),
        orderMaxStep: Number(orderMaxStep) || 2,
        orderMap: orderMap && typeof orderMap === "object" ? orderMap : {}
      };
      const title = `${sendSelectedTitle || "Request"}${sendKind ? ` (${sendKind})` : ""}`.trim();
      const saved = saveLocalDraft(session, {
        id: activeDraftId || "",
        type: "request",
        title,
        payload
      });
      setActiveDraftId(saved?.id || "");
      setLocalError("");
      setSendDraftAvailable(true);
      toast("Draft saved. Open Drafts to continue later.", "success");
    } catch {
      setLocalError("Failed to save draft");
    }
  }, [
    allRecipientEmails,
    activeDraftId,
    session,
    notify,
    notifyMessage,
    orderEnabled,
    orderMap,
    orderMaxStep,
    sendDueDate,
    sendKind,
    sendSelectedId,
    sendSelectedTitle
  ]);

  const applyDraftPayload = useCallback((payload) => {
    const data = payload && typeof payload === "object" ? payload : {};
    setSendKind(String(data.kind || "approval"));
    setSendSelectedId(String(data.templateId || ""));
    setSendSelectedTitle(String(data.templateTitle || ""));
    setSendDueDate(String(data.dueDate || ""));
    const recipients = Array.isArray(data.recipients) ? data.recipients : [];
    setPickedMemberIds(new Set());
    setInviteEmails(recipients.join("\n"));
    setNotify(Boolean(data.notify));
    setNotifyMessage(String(data.message || ""));
    setOrderEnabled(Boolean(data.orderEnabled));
    setOrderMaxStep(Number(data.orderMaxStep) || 2);
    setOrderMap(data.orderMap && typeof data.orderMap === "object" ? data.orderMap : {});
    setSendStep("recipients");
    setLocalError("");
  }, []);

  const loadLastDraft = useCallback(() => {
    try {
      const list = listLocalDrafts(session).filter((d) => d.type === "request");
      if (!list.length) return false;
      const latest = list[0];
      setActiveDraftId(String(latest.id || ""));
      applyDraftPayload(latest.payload);
      toast("Draft loaded.", "success");
      return true;
    } catch {
      setLocalError("Failed to load draft");
      return false;
    }
  }, [applyDraftPayload, session]);

  const clearDraftSelection = useCallback(() => {
    const had = Boolean(String(activeDraftId || "").trim());
    setActiveDraftId("");
    refreshSendDraftAvailable();
    if (had) toast("Draft cleared.", "info");
  }, [activeDraftId, refreshSendDraftAvailable]);

  useEffect(() => {
    const handler = (evt) => {
      const payload = evt?.detail?.payload || null;
      if (!payload) return;
      setSendOpen(true);
      setTimeout(() => applyDraftPayload(payload), 0);
    };
    window.addEventListener("portal:requestsLoadDraft", handler);
    return () => window.removeEventListener("portal:requestsLoadDraft", handler);
  }, [applyDraftPayload]);

  useEffect(() => {
    const handler = () => {
      if (!hasProject) {
        onOpenProjects();
        return;
      }
      setSendOpen(true);
    };
    window.addEventListener("portal:requestsNewRequest", handler);
    return () => window.removeEventListener("portal:requestsNewRequest", handler);
  }, [hasProject, onOpenProjects]);

  useEffect(() => {
    if (!sendOpen) return;
    refreshSendDraftAvailable();
  }, [refreshSendDraftAvailable, sendOpen]);

  useEffect(() => {
    if (!sendOpen) return;
    if (!orderEnabled) return;
    const emails = allRecipientEmails || [];
    setOrderMap((prev) => {
      const next = { ...(prev || {}) };
      // Ensure all current recipients have a step.
      for (const email of emails) {
        const key = String(email || "").trim().toLowerCase();
        if (!key) continue;
        const value = Number(next[key]);
        if (!Number.isFinite(value) || value < 1) next[key] = 1;
      }
      // Drop removed recipients.
      for (const key of Object.keys(next)) {
        if (!emails.map((e) => String(e || "").trim().toLowerCase()).includes(key)) {
          delete next[key];
        }
      }
      return next;
    });
  }, [allRecipientEmails, orderEnabled, sendOpen]);

  useEffect(() => {
    if (!sendOpen) return;

    setSendSelectedId("");
    setSendSelectedTitle("");
    setSendFlow(null);
    setSendFlows([]);
    setSendKind("approval");
    setSendDueDate("");
    setSendWarning("");
    setSendStep("setup");
    setSendAdvanced(false);
    setMemberQuery("");
    setOrderEnabled(false);
    setOrderMap({});
    setOrderMaxStep(2);
    setSendQuery("");
    setPickedMemberIds(new Set());
    setInviteEmails("");
    setNotify(true);
    setNotifyMessage("");
    setDirMode("people");
    setDirPeopleQuery("");
    setDirPeople([]);
    setDirPeopleTotal(0);
    setDirGroups([]);
    setDirGroupQuery("");
    setDirSelectedGroupIds(new Set());
    setDirGroupMembersById({});
    setDirGroupLoadingIds(new Set());
    setPickedDirectoryEmails(new Set());
    setDirectoryError("");
    setMembersError("");

    if (!token || !projectId) {
      setMembers([]);
      setProjectPerms({});
      return;
    }

    setMembersLoading(true);
    Promise.all([
      getProjectMembers({ token, projectId }).catch((e) => {
        setMembersError(e?.message || "Failed to load project people");
        return null;
      }),
      getProjectsPermissions({ token }).catch(() => null)
    ])
      .then(([membersRes, permsRes]) => {
        setMembers(Array.isArray(membersRes?.members) ? membersRes.members : []);
        setProjectPerms(permsRes?.permissions && typeof permsRes.permissions === "object" ? permsRes.permissions : {});
      })
      .finally(() => setMembersLoading(false));
  }, [projectId, sendOpen, token]);

  useEffect(() => {
    if (!sendOpen) return;
    if (sendStep !== "recipients") return;
    if (!token) return;

    let cancelled = false;
    setDirectoryLoading(true);
    setDirectoryError("");

    Promise.allSettled([listDirectoryGroups({ token }), listDirectoryPeople({ token, limit: 25, offset: 0 })]).then((results) => {
      if (cancelled) return;

      let nextError = "";
      const groupsRes = results[0];
      if (groupsRes?.status === "fulfilled") {
        setDirGroups(Array.isArray(groupsRes.value?.groups) ? groupsRes.value.groups : []);
      } else {
        setDirGroups([]);
        nextError = groupsRes?.reason?.message || "Failed to load directory";
      }

      const peopleRes = results[1];
      if (peopleRes?.status === "fulfilled") {
        const list = Array.isArray(peopleRes.value?.people) ? peopleRes.value.people : [];
        const total = Number.isFinite(Number(peopleRes.value?.total)) ? Number(peopleRes.value.total) : list.length;
        setDirPeople(list);
        setDirPeopleTotal(total);
      } else {
        setDirPeople([]);
        setDirPeopleTotal(0);
        if (!nextError) nextError = peopleRes?.reason?.message || "Failed to load directory";
      }

      setDirectoryError(nextError);
    }).finally(() => {
      if (cancelled) return;
      setDirectoryLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [projectId, sendOpen, sendStep, token]);

  useEffect(() => {
    if (!sendOpen || sendStep !== "recipients") return;
    if (!token) return;
    if (dirMode !== "people") return;
    const q = String(dirPeopleQuery || "").trim();
    if (!q) {
      if (Array.isArray(dirPeople) && dirPeople.length) return;
      if (Number(dirPeopleTotal) > 0) return;

      let cancelled = false;
      setDirectoryLoading(true);
      setDirectoryError("");
      listDirectoryPeople({ token, limit: 25, offset: 0 })
        .then((data) => {
          if (cancelled) return;
          const list = Array.isArray(data?.people) ? data.people : [];
          const total = Number.isFinite(Number(data?.total)) ? Number(data.total) : list.length;
          setDirPeople(list);
          setDirPeopleTotal(total);
        })
        .catch((e) => {
          if (cancelled) return;
          setDirPeople([]);
          setDirPeopleTotal(0);
          setDirectoryError(e?.message || "Failed to load people");
        })
        .finally(() => {
          if (cancelled) return;
          setDirectoryLoading(false);
        });

      return;
    }

    let cancelled = false;
    setDirectoryLoading(true);
    setDirectoryError("");
    const handle = setTimeout(() => {
      searchDirectoryPeople({ token, query: q })
        .then((data) => {
          if (cancelled) return;
          setDirPeople(Array.isArray(data?.people) ? data.people : []);
          setDirPeopleTotal(0);
        })
        .catch((e) => {
          if (cancelled) return;
          setDirPeople([]);
          setDirPeopleTotal(0);
          setDirectoryError(e?.message || "Failed to search people");
        })
        .finally(() => {
          if (cancelled) return;
          setDirectoryLoading(false);
        });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [dirMode, dirPeople, dirPeopleQuery, dirPeopleTotal, sendOpen, sendStep, token]);

  useEffect(() => {
    if (!sendOpen || sendStep !== "recipients") return;
    if (!token) return;
    if (dirMode !== "groups") return;
    const selected = Array.from(dirSelectedGroupIds instanceof Set ? dirSelectedGroupIds : [])
      .map((x) => String(x || "").trim())
      .filter(Boolean);
    if (!selected.length) return;

    let cancelled = false;

    const fetchMissing = async () => {
      for (const gid of selected) {
        if (cancelled) return;
        if (dirGroupMembersById && typeof dirGroupMembersById === "object" && Array.isArray(dirGroupMembersById[gid])) continue;

        setDirGroupLoadingIds((prev) => {
          const next = new Set(prev instanceof Set ? prev : []);
          next.add(gid);
          return next;
        });

        try {
          // eslint-disable-next-line no-await-in-loop
          const data = await getDirectoryGroup({ token, groupId: gid });
          const members = Array.isArray(data?.members) ? data.members : [];
          if (!cancelled) {
            setDirGroupMembersById((prev) => ({ ...(prev && typeof prev === "object" ? prev : {}), [gid]: members }));
          }
        } catch (e) {
          if (!cancelled) setDirectoryError(e?.message || "Failed to load group members");
        } finally {
          setDirGroupLoadingIds((prev) => {
            const next = new Set(prev instanceof Set ? prev : []);
            next.delete(gid);
            return next;
          });
        }
      }
    };

    fetchMissing().catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [dirGroupMembersById, dirMode, dirSelectedGroupIds, sendOpen, sendStep, token]);

  // Permissions are enforced server-side (user token).

  const openFlow = (flow) => {
    if (String(flow?.status || "") === "Canceled") return;
    const status = String(flow?.status || "");
    const url = String((status === "Completed" ? flow?.resultFileUrl || flow?.openUrl : flow?.openUrl) || "").trim();
    if (!url) return;
    const kind = normalizeKind(flow?.kind);
    setModalTitle(flow?.fileTitle || flow?.templateTitle || "Document");
    setModalUrl((kind === "fillSign" || kind === "sharedSign") && status !== "Completed" ? withFillAction(url) : url);
    setModalOpen(true);
  };

  const canManageFlow = (flow) => {
    const rid = String(flow?.projectRoomId || "").trim();
    const pid = rid ? projectIdByRoomId.get(rid) : "";
    if (!pid) return false;
    return Boolean(projectPerms?.[String(pid)]);
  };

  const isAssignedToMe = (flow) => {
    const recipients = Array.isArray(flow?.recipientEmails) ? flow.recipientEmails : [];
    if (!meEmail || !recipients.length) return false;
    return recipients.map((e) => String(e || "").trim().toLowerCase()).includes(meEmail);
  };

  const onCancel = async (flow) => {
    const id = String(flow?.id || "").trim();
    if (!id || !token) return;
    setLocalError("");
    setActionBusy(true);
    try {
      await cancelFlow({ token, flowId: id });
      window.dispatchEvent(new CustomEvent("portal:flowsChanged"));
      toast("Request canceled", "success");
    } catch (e) {
      const msg = e?.message || "Failed to cancel request";
      setLocalError(msg);
      toast(msg, "error");
    } finally {
      setActionBusy(false);
    }
  };

  const onCancelGroup = async (group) => {
    const items = Array.isArray(group?.flows) ? group.flows : [];
    const ids = items.map((f) => String(f?.id || "").trim()).filter(Boolean);
    if (!ids.length || !token) return;
    setLocalError("");
    setActionBusy(true);
    try {
      const failures = [];
      for (const id of ids) {
        // eslint-disable-next-line no-await-in-loop
        await cancelFlow({ token, flowId: id }).catch((e) => failures.push(e));
      }
      window.dispatchEvent(new CustomEvent("portal:flowsChanged"));
      if (failures.length) {
        const msg = failures[0]?.message || "Some requests could not be canceled";
        setLocalError(msg);
        toast(msg, "error");
      } else {
        toast("Requests canceled", "success");
      }
    } catch (e) {
      const msg = e?.message || "Failed to cancel request";
      setLocalError(msg);
      toast(msg, "error");
    } finally {
      setActionBusy(false);
    }
  };

  const onReopenGroup = async (group) => {
    const items = Array.isArray(group?.flows) ? group.flows : [];
    const ids = items
      .filter((f) => String(f?.status || "") === "Canceled")
      .map((f) => String(f?.id || "").trim())
      .filter(Boolean);
    if (!ids.length || !token) return;
    setLocalError("");
    setActionBusy(true);
    try {
      for (const id of ids) {
        // eslint-disable-next-line no-await-in-loop
        await reopenFlow({ token, flowId: id }).catch(() => null);
      }
      window.dispatchEvent(new CustomEvent("portal:flowsChanged"));
      toast("Requests reopened", "success");
    } catch (e) {
      setLocalError(e?.message || "Failed to reopen request");
    } finally {
      setActionBusy(false);
    }
  };

  const onArchiveGroup = async (group) => {
    const items = Array.isArray(group?.flows) ? group.flows : [];
    const ids = items.map((f) => String(f?.id || "").trim()).filter(Boolean);
    if (!ids.length || !token) return;
    setLocalError("");
    setActionBusy(true);
    try {
      for (const id of ids) {
        // eslint-disable-next-line no-await-in-loop
        await archiveFlow({ token, flowId: id }).catch(() => null);
      }
      window.dispatchEvent(new CustomEvent("portal:flowsChanged"));
      toast("Requests archived", "success");
    } catch (e) {
      setLocalError(e?.message || "Failed to archive request");
    } finally {
      setActionBusy(false);
    }
  };

  const onUnarchiveGroup = async (group) => {
    const items = Array.isArray(group?.flows) ? group.flows : [];
    const ids = items.map((f) => String(f?.id || "").trim()).filter(Boolean);
    if (!ids.length || !token) return;
    setLocalError("");
    setActionBusy(true);
    try {
      for (const id of ids) {
        // eslint-disable-next-line no-await-in-loop
        await unarchiveFlow({ token, flowId: id }).catch(() => null);
      }
      window.dispatchEvent(new CustomEvent("portal:flowsChanged"));
      toast("Requests restored", "success");
    } catch (e) {
      setLocalError(e?.message || "Failed to restore request");
    } finally {
      setActionBusy(false);
    }
  };

  const onTrashGroup = async (group) => {
    const items = Array.isArray(group?.flows) ? group.flows : [];
    const ids = items.map((f) => String(f?.id || "").trim()).filter(Boolean);
    if (!ids.length || !token) return;
    setLocalError("");
    setActionBusy(true);
    try {
      for (const id of ids) {
        // eslint-disable-next-line no-await-in-loop
        await trashFlow({ token, flowId: id }).catch(() => null);
      }
      window.dispatchEvent(new CustomEvent("portal:flowsChanged"));
      toast("Moved to trash", "success");
    } catch (e) {
      setLocalError(e?.message || "Failed to move request to trash");
    } finally {
      setActionBusy(false);
    }
  };

  const onUntrashGroup = async (group) => {
    const items = Array.isArray(group?.flows) ? group.flows : [];
    const ids = items.map((f) => String(f?.id || "").trim()).filter(Boolean);
    if (!ids.length || !token) return;
    setLocalError("");
    setActionBusy(true);
    try {
      for (const id of ids) {
        // eslint-disable-next-line no-await-in-loop
        await untrashFlow({ token, flowId: id }).catch(() => null);
      }
      window.dispatchEvent(new CustomEvent("portal:flowsChanged"));
      toast("Restored from trash", "success");
    } catch (e) {
      setLocalError(e?.message || "Failed to restore request");
    } finally {
      setActionBusy(false);
    }
  };

  const onDeleteGroupPermanently = async (group) => {
    const items = Array.isArray(group?.flows) ? group.flows : [];
    const ids = items.map((f) => String(f?.id || "").trim()).filter(Boolean);
    if (!ids.length || !token) return;
    setLocalError("");
    setActionBusy(true);
    try {
      for (const id of ids) {
        // eslint-disable-next-line no-await-in-loop
        await deleteFlowPermanently({ token, flowId: id }).catch(() => null);
      }
      window.dispatchEvent(new CustomEvent("portal:flowsChanged"));
      toast("Requests deleted", "success");
    } catch (e) {
      setLocalError(e?.message || "Failed to delete request");
    } finally {
      setActionBusy(false);
    }
  };

  const runBulk = async () => {
    if (!bulkCandidates.length || !token) return;
    setLocalError("");
    setActionBusy(true);
    try {
      for (const group of bulkCandidates) {
        const items = Array.isArray(group?.flows) ? group.flows : [];
        const ids = items.map((f) => String(f?.id || "").trim()).filter(Boolean);
        for (const id of ids) {
          // eslint-disable-next-line no-await-in-loop
          if (bulkMode === "restore") await unarchiveFlow({ token, flowId: id }).catch(() => null);
          else await archiveFlow({ token, flowId: id }).catch(() => null);
        }
      }
      window.dispatchEvent(new CustomEvent("portal:flowsChanged"));
      toast(bulkMode === "restore" ? "Requests restored" : "Requests archived", "success");
    } catch (e) {
      setLocalError(e?.message || "Bulk action failed");
    } finally {
      setActionBusy(false);
      setBulkOpen(false);
      setBulkCandidates([]);
    }
  };

  const onComplete = async (flow) => {
    const id = String(flow?.id || "").trim();
    if (!id || !token) return;
    setLocalError("");
    setActionBusy(true);
    try {
      await completeFlow({ token, flowId: id });
      window.dispatchEvent(new CustomEvent("portal:flowsChanged"));
      toast("Request completed", "success");
    } catch (e) {
      setLocalError(e?.message || "Failed to complete request");
    } finally {
      setActionBusy(false);
    }
  };

  const onNewRequest = useCallback(() => {
    if (!hasProject) {
      onOpenProjects();
      return;
    }
    setSendStep("setup");
    setSendOpen(true);
  }, [hasProject, onOpenProjects]);

  useEffect(() => {
    const handler = (event) => {
      const detail = event?.detail && typeof event.detail === "object" ? event.detail : null;
      if (!detail || String(detail.page || "") !== "requests" || String(detail.action || "") !== "openNewRequest") return;
      if (!hasProject) {
        onOpenProjects();
        return;
      }
      const desiredStep = String(detail.step || "").trim();
      if (desiredStep === "setup" || desiredStep === "recipients") setSendStep(desiredStep);
      setSendOpen(true);
    };
    window.addEventListener("portal:tour", handler);
    return () => window.removeEventListener("portal:tour", handler);
  }, [hasProject, onOpenProjects]);

  const onCopyLink = async (value) => {
    const url = String(value || "").trim();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast("Link copied", "success");
    } catch {
      // ignore; user can copy manually
    }
  };

  const onCreateFlow = async () => {
    const templateFileId = String(sendSelectedId || "").trim();
    if (!templateFileId) return;
    if (!hasProject) return;
    let recipientLevels = null;
    if ((sendKind === "sharedSign" || sendKind === "approval") && orderEnabled) {
      const emails = (allRecipientEmails || []).map((e) => String(e || "").trim().toLowerCase()).filter(Boolean);
      const map = orderMap && typeof orderMap === "object" ? orderMap : {};
      const maxStep = Math.max(1, Number(orderMaxStep) || 1);
      const levels = Array.from({ length: maxStep }, () => []);
      for (const email of emails) {
        const step = Number(map[email] || 1);
        const idx = Number.isFinite(step) && step >= 1 ? Math.min(step, maxStep) - 1 : 0;
        levels[idx].push(email);
      }
      recipientLevels = levels.filter((lvl) => lvl.length);
    }

    const dueDate = String(sendDueDate || "").trim() || null;
    const result = await onStartFlow?.(templateFileId, projectId, allRecipientEmails, sendKind, recipientLevels, dueDate);
    const flows = Array.isArray(result?.flows) ? result.flows : result?.flow ? [result.flow] : [];
    setSendFlows(flows);
    setSendFlow(flows[0] || null);
    setSendWarning(String(result?.warning || "").trim());
    if (flows.length) {
      setActiveDraftId("");
      refreshSendDraftAvailable();
    }
  };

  const onNotifyRecipients = async () => {
    if (!sendFlows.length) return;
    if (!projectId || !token) return;
    if (!canManageProject) return;

    const emails = (() => {
      const list = allRecipientEmails;
      if (!orderEnabled || (sendKind !== "sharedSign" && sendKind !== "approval")) return list;
      const map = orderMap && typeof orderMap === "object" ? orderMap : {};
      const stage0 = list.filter((e) => Number(map[String(e || "").trim().toLowerCase()] || 1) === 1);
      return stage0.length ? stage0 : list;
    })();
    if (!emails.length) return;

    setNotifyBusy(true);
    try {
      const base = String(notifyMessage || "").trim();
      const portalUrl = typeof window !== "undefined" ? String(window.location?.origin || "").trim() : "";
      const finalMessage =
        sendKind === "fillSign"
          ? (() => {
              const link = String(sendFlow?.openUrl || "").trim();
              const defaultMsg = `You have a new document to fill and sign.${link ? `\n\nOpen: ${link}` : portalUrl ? `\n\nOpen: ${portalUrl}` : ""}`;
              return base || defaultMsg;
            })()
          : sendKind === "sharedSign"
            ? (() => {
                const link = String(sendFlow?.openUrl || "").trim();
                const defaultMsg = `You have a document to review and sign.${link ? `\n\nOpen: ${link}` : portalUrl ? `\n\nOpen: ${portalUrl}` : ""}`;
                return base || defaultMsg;
              })()
          : (() => {
              const link = String(sendFlow?.openUrl || "").trim();
              return base ? `${base}\n\nApproval link: ${link}` : `You have a new approval request.\n\nOpen: ${link}`;
            })();
      await inviteProject({
        token,
        projectId,
        emails: emails.join(","),
        access: "FillForms",
        notify: Boolean(notify),
        message: Boolean(notify) ? finalMessage : ""
      });
    } finally {
      setNotifyBusy(false);
    }
  };

  const notifyGroup = async (group, { reminder = false } = {}) => {
    const flow = group?.primaryFlow || group?.flows?.[0] || null;
    const rid = String(flow?.projectRoomId || "").trim();
    const pid = rid ? projectIdByRoomId.get(rid) : "";
    const canManage = flow ? canManageFlow(flow) : false;
    if (!pid || !token || !canManage) return;

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

    const kind = normalizeKind(flow?.kind);
    const title = flow?.fileTitle || flow?.templateTitle || "Request";
    const portalUrl = typeof window !== "undefined" ? String(window.location?.origin || "").trim() : "";
    const link = String(flow?.openUrl || "").trim();

    const base =
      kind === "fillSign"
        ? `Please fill and sign: ${title}.`
        : kind === "sharedSign"
          ? `Please review and sign: ${title}.`
          : `You have a new approval request: ${title}.`;

    const message = `${reminder ? "Reminder: " : ""}${base}${link ? `\n\nOpen: ${link}` : portalUrl ? `\n\nOpen: ${portalUrl}` : ""}`;

    setLocalError("");
    setActionBusy(true);
    try {
      await inviteProject({
        token,
        projectId: pid,
        emails: emails.join(","),
        access: "FillForms",
        notify: true,
        message
      });
    } catch (e) {
      setLocalError(e?.message || "Notify failed");
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div className="page-shell">
      <header className="topbar">
        <div>
          <h2>Requests</h2>
          <p className="muted">
            {hasProject ? (
              <>
                Tracking requests in "{projectTitle || "Current project"}".{" "}
                <StatusPill tone={canManageProject ? "blue" : "gray"}>{canManageProject ? "Admin" : "View-only"}</StatusPill>
              </>
            ) : (
              "Pick a project to create and track requests."
            )}
          </p>
        </div>
        <div className="topbar-actions">
          <button type="button" onClick={onOpenProjects} disabled={busy}>
            Projects
          </button>
          <button type="button" onClick={onOpenDrafts} disabled={busy}>
            Templates
          </button>
          <button type="button" className="primary" onClick={onNewRequest} disabled={busy} data-tour="requests:new">
            {hasProject ? "New request" : "Choose project"}
          </button>
        </div>
      </header>

      {error || localError ? <p className="error">{error || localError}</p> : null}

      <section className="card page-card">
        <div className="card-header compact">
          <div>
            <h3>Requests</h3>
            <p className="muted">{scope === "current" ? "Showing requests from the current project." : "Showing requests from all projects you can access."}</p>
          </div>
          <div className="card-header-actions request-header-actions">
            <div className="request-header-tools" data-tour="requests:toolbar">
              {flowsRefreshing ? (
                <span className="muted" style={{ fontSize: 12 }}>
                  Updating...
                </span>
              ) : updatedLabel ? (
                <span className="muted" style={{ fontSize: 12 }}>
                  Updated {updatedLabel}
                </span>
              ) : null}
              <span className="muted">{filteredGroups.length} shown</span>
              {(() => {
                const candidates =
                  statusFilter === "archived"
                    ? filteredGroups.filter((g) => {
                        const f = g?.primaryFlow || g?.flows?.[0] || null;
                        return f && Boolean(f?.archivedAt) && canManageFlow(f);
                      })
                    : statusFilter === "completed" || statusFilter === "other"
                      ? filteredGroups.filter((g) => {
                          const f = g?.primaryFlow || g?.flows?.[0] || null;
                          const st = String(g?.status || f?.status || "");
                          if (!f) return false;
                          if (st !== "Completed" && st !== "Canceled") return false;
                          return canManageFlow(f);
                        })
                      : [];

                if (!candidates.length) return null;
                return (
                  <button
                    type="button"
                    onClick={() => {
                      setBulkCandidates(candidates);
                      setBulkMode(statusFilter === "archived" ? "restore" : "archive");
                      setBulkOpen(true);
                    }}
                    disabled={busy || actionBusy}
                  >
                    {statusFilter === "archived"
                      ? `Restore shown (${candidates.length})`
                      : `Archive shown (${candidates.length})`}
                  </button>
                );
              })()}
              <button
                type="button"
                onClick={() => (typeof onRefreshFlows === "function" ? onRefreshFlows() : null)}
                disabled={busy || flowsRefreshing || !token}
              >
                Refresh
              </button>
              <label className="inline-check">
                <input
                  type="checkbox"
                  checked={Boolean(autoRefresh)}
                  onChange={(e) => setAutoRefresh(Boolean(e.target.checked))}
                  disabled={busy || !token}
                />
                <span>Auto-refresh</span>
              </label>
            </div>
          </div>
        </div>

        <div className="request-filters" data-tour="requests:filters">
          <Tabs className="tabs-scope" value={scope} onChange={setScope} items={scopeTabs} ariaLabel="Project scope" />
          <Tabs className="tabs-who" value={who} onChange={setWho} items={whoTabs} ariaLabel="Requests scope" />
          <div className="chip-row" aria-label="Status filter">
            <button
              type="button"
              className={`chip${statusFilter === "all" ? " is-active" : ""}`}
              onClick={() => setStatusFilter("all")}
              disabled={busy}
            >
              All
            </button>
            <button
              type="button"
              className={`chip${statusFilter === "inProgress" ? " is-active" : ""}`}
              onClick={() => setStatusFilter("inProgress")}
              disabled={busy}
            >
              In progress
            </button>
            <button
              type="button"
              className={`chip${statusFilter === "overdue" ? " is-active" : ""}`}
              onClick={() => setStatusFilter("overdue")}
              disabled={busy}
            >
              Overdue
            </button>
            <button
              type="button"
              className={`chip${statusFilter === "completed" ? " is-active" : ""}`}
              onClick={() => setStatusFilter("completed")}
              disabled={busy}
            >
              Completed
            </button>
            <button
              type="button"
              className={`chip${statusFilter === "other" ? " is-active" : ""}`}
              onClick={() => setStatusFilter("other")}
              disabled={busy}
            >
              Other
            </button>
            <button
              type="button"
              className={`chip${statusFilter === "links" ? " is-active" : ""}`}
              onClick={() => setStatusFilter("links")}
              disabled={busy}
            >
              Links
            </button>
            <button
              type="button"
              className={`chip${statusFilter === "trash" ? " is-active" : ""}`}
              onClick={() => setStatusFilter("trash")}
              disabled={busy || trashedRefreshing}
            >
              Trash
            </button>
            <button
              type="button"
              className={`chip${statusFilter === "archived" ? " is-active" : ""}`}
              onClick={() => setStatusFilter("archived")}
              disabled={busy || archivedRefreshing}
            >
              Archived
            </button>
          </div>
          <input
            className="request-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search..."
            disabled={busy || (scope === "current" && !hasProject)}
          />
        </div>

        <div className="list scroll-area">
          {statusFilter === "archived" && archivedError ? <p className="error">{archivedError}</p> : null}
          {statusFilter === "trash" && trashedError ? <p className="error">{trashedError}</p> : null}
          {scope === "current" && !hasProject ? (
            <EmptyState
              title={hasAnyProjects ? "No project selected" : "No projects yet"}
              description={hasAnyProjects ? "Pick a project to see its requests." : "Create a project to publish templates and start requests."}
              actions={
                <button
                  type="button"
                  className="primary"
                  onClick={() => onOpenProjects?.({ create: !hasAnyProjects })}
                  disabled={busy}
                >
                  {hasAnyProjects ? "Open Projects" : "Create project"}
                </button>
              }
            />
          ) : filteredGroups.length === 0 ? (
            String(query || "").trim() ? (
              <EmptyState
                title="Nothing found"
                description={`No requests match "${String(query || "").trim()}".`}
                actions={
                  <button type="button" onClick={() => setQuery("")} disabled={busy}>
                    Clear search
                  </button>
                }
              />
            ) : statusFilter === "archived" ? (
              <EmptyState
                title="No archived requests"
                description="Archive completed or canceled requests to keep your inbox clean."
                actions={
                  <button type="button" onClick={() => setStatusFilter("all")} disabled={busy}>
                    View active requests
                  </button>
                }
              />
            ) : statusFilter === "trash" ? (
              <EmptyState
                title="Trash is empty"
                description="Move completed or canceled requests to trash to hide them from your list."
                actions={
                  <button type="button" onClick={() => setStatusFilter("all")} disabled={busy}>
                    View all requests
                  </button>
                }
              />
            ) : statusFilter === "links" ? (
              <EmptyState
                title="No links yet"
                description="Generate links from Bulk links, then track them here."
                actions={
                  <button type="button" onClick={() => setStatusFilter("all")} disabled={busy}>
                    View all requests
                  </button>
                }
              />
            ) : who === "assigned" ? (
              <EmptyState
                title="No assigned requests"
                description="Requests assigned to your email will appear here."
                actions={
                  <button type="button" onClick={() => setWho("created")} disabled={busy}>
                    View created requests
                  </button>
                }
              />
            ) : (
              <EmptyState
                title="No requests yet"
                description="Create a request from a published template to share a link and track progress."
                actions={
                  <button type="button" className="primary" onClick={onNewRequest} disabled={busy}>
                    {hasProject ? "New request" : "Choose project"}
                  </button>
                }
              />
            )
          ) : (
            filteredGroups.map((group, idx) => {
              const flow = group.primaryFlow || group.flows?.[0] || {};
              const title = flow.fileTitle || flow.templateTitle || `Template ${flow.templateFileId}`;
              const kindLower = String(flow?.kind || "").toLowerCase();
              const isFillSign = kindLower === "fillsign";
              const isSharedSign = kindLower === "sharedsign";
              const status = String(group.status || flow.status || "");
              const counts = group?.counts || { total: 1, completed: 0 };
              const meta = counts.total > 1 ? `${counts.completed || 0}/${counts.total} completed` : "";
              const dueDate =
                String(flow?.dueDate || "").trim() ||
                String((Array.isArray(group?.flows) ? group.flows.find((f) => String(f?.dueDate || "").trim())?.dueDate : "") || "").trim();
              const isOverdue = (Array.isArray(group?.flows) ? group.flows : []).some((f) => isOverdueFlow(f));
              const createdAt = String(group.createdAt || flow.createdAt || "")
                .slice(0, 19)
                .replace("T", " ")
                .trim();

              return (
               <div key={group.id} className="list-row request-row">
                 <div className="list-main">
                   <strong className="truncate">{title}</strong>
                  <span className="muted request-row-meta">
                      {isFillSign ? <StatusPill tone="blue">Fill &amp; Sign</StatusPill> : null}{" "}
                      {isSharedSign ? <StatusPill tone="gray">Contract</StatusPill> : null}{" "}
                    {status === "Canceled" ? (
                      <StatusPill tone="red">Canceled</StatusPill>
                    ) : status === "InProgress" ? (
                      <StatusPill tone="yellow">In progress</StatusPill>
                    ) : status === "Completed" ? (
                      <StatusPill tone="green">Completed</StatusPill>
                    ) : (
                      <StatusPill tone="gray">{status || "-"}</StatusPill>
                    )}{" "}
                    {meta ? <StatusPill tone="gray">{meta}</StatusPill> : null}{" "}
                    {dueDate ? (
                      <StatusPill tone={isOverdue ? "red" : "gray"}>{isOverdue ? `Overdue: ${dueDate}` : `Due: ${dueDate}`}</StatusPill>
                    ) : null}{" "}
                    {statusFilter === "archived" && flow?.archivedAt ? (
                      <StatusPill tone="gray">{`Archived: ${String(flow.archivedAt).slice(0, 10)}`}</StatusPill>
                    ) : null}{" "}
                     {scope !== "current" ? (
                       <StatusPill tone="gray">
                         {(() => {
                           const rid = String(flow?.projectRoomId || group?.projectRoomId || "").trim();
                           if (!rid) return "Unassigned";
                           return roomTitleById.get(rid) || "Project";
                         })()}
                       </StatusPill>
                     ) : null}{" "}
                    {createdAt ? <StatusPill tone="gray">{`Created: ${createdAt}`}</StatusPill> : null}
                  </span>
                </div>
                <div className="list-actions" data-tour={idx === 0 ? "requests:row-actions" : undefined}>
                  <button
                    type="button"
                    className="primary"
                    onClick={() => openFlow(flow)}
                    disabled={!(status === "Completed" ? flow?.resultFileUrl || flow?.openUrl : flow?.openUrl) || busy || status === "Canceled"}
                    title={status === "Canceled" ? "Canceled requests cannot be opened" : ""}
                  >
                    {status === "Completed" ? "Open result" : "Open"}
                  </button>
                  {(() => {
                    const kind = normalizeKind(flow?.kind);
                    const canManage = canManageFlow(flow);
                    const canComplete =
                      kind === "sharedSign" &&
                      status !== "Completed" &&
                      status !== "Canceled" &&
                      Boolean((flow && isAssignedToMe(flow)) || canManage);
                    if (!canComplete) return null;
                    return (
                      <button
                        type="button"
                        onClick={() => {
                          setActionsGroup(group);
                          setCompleteOpen(true);
                        }}
                        disabled={busy || actionBusy}
                      >
                        Complete
                      </button>
                    );
                  })()}
                  {(() => {
                    const canManage = canManageFlow(flow);
                    const canCancel = canManage && status === "InProgress";
                    if (!canCancel) return null;
                    return (
                      <button
                        type="button"
                        className="danger"
                        onClick={() => {
                          setActionsGroup(group);
                          setCancelOpen(true);
                        }}
                        disabled={busy || actionBusy}
                      >
                        Cancel
                      </button>
                    );
                  })()}
                  <button
                    type="button"
                    className="icon-button"
                    onClick={(e) => {
                      setActionsGroup(group);
                      setActionsAnchorEl(e.currentTarget);
                      setActionsMenuOpen(true);
                    }}
                    disabled={busy || actionBusy}
                    aria-label="More actions"
                    title="More actions"
                  />
                </div>
              </div>
              );
            })
          )}
        </div>
      </section>

      <ContextMenu open={actionsMenuOpen} anchorEl={actionsAnchorEl} onClose={closeActionsMenu} ariaLabel="Request actions">
        {(() => {
          const group = actionsGroup;
          const flow = group?.primaryFlow || group?.flows?.[0] || null;
          if (!flow) return null;

          const status = String(group?.status || flow?.status || "");
          const kind = normalizeKind(flow?.kind);
          const canManage = canManageFlow(flow);
          const isArchived = Boolean(flow?.archivedAt);
          const isTrashed = Boolean(flow?.trashedAt);
          const canReopen = status === "Canceled" && canManage;
          const canCancel = canManage && status === "InProgress";
          const canArchive = canManage && !isArchived && (status === "Completed" || status === "Canceled");
          const canUnarchive = canManage && isArchived;
          const canTrash = canManage && !isTrashed && (status === "Completed" || status === "Canceled" || isArchived);
          const canUntrash = canManage && isTrashed;
          const canDelete = canManage && isTrashed && statusFilter === "trash";

          const openUrl = String((status === "Completed" ? flow?.resultFileUrl || flow?.openUrl : flow?.openUrl) || "").trim();
          const canCopyLink = Boolean(openUrl) && kind !== "fillsign";

          const hasManageActions = canReopen || canArchive || canUnarchive || canTrash || canUntrash || canCancel || canDelete;

          return (
            <>
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  closeActionsMenu();
                  setDetailsGroup(group);
                  setDetailsOpen(true);
                }}
              >
                <span>Details</span>
                <span className="menu-item-meta">Recipients, due date</span>
              </button>
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  closeActionsMenu();
                  setActionsGroup(group);
                  setAuditOpen(true);
                }}
                disabled={busy || actionBusy}
              >
                <span>Activity</span>
                <span className="menu-item-meta">Timeline</span>
              </button>
                {canCopyLink ? (
                  <button
                    type="button"
                    className="menu-item"
                    onClick={() => {
                      closeActionsMenu();
                      onCopyLink(openUrl);
                    }}
                    disabled={busy || actionBusy || !openUrl}
                  >
                    <span>Copy link</span>
                    <span className="menu-item-meta">Requires sign-in</span>
                  </button>
                ) : null}

              {hasManageActions ? <div className="menu-sep" role="separator" /> : null}

              {canReopen ? (
                <button
                  type="button"
                  className="menu-item"
                  onClick={async () => {
                    closeActionsMenu();
                    await onReopenGroup(group);
                  }}
                  disabled={busy || actionBusy}
                >
                  <span>Reopen</span>
                  <span className="menu-item-meta">Undo cancel</span>
                </button>
              ) : null}

              {canUntrash ? (
                <button
                  type="button"
                  className="menu-item"
                  onClick={async () => {
                    closeActionsMenu();
                    await onUntrashGroup(group);
                  }}
                  disabled={busy || actionBusy}
                >
                  <span>Restore</span>
                  <span className="menu-item-meta">From trash</span>
                </button>
              ) : null}

              {canUnarchive ? (
                <button
                  type="button"
                  className="menu-item"
                  onClick={async () => {
                    closeActionsMenu();
                    await onUnarchiveGroup(group);
                  }}
                  disabled={busy || actionBusy}
                >
                  <span>Restore</span>
                  <span className="menu-item-meta">From archive</span>
                </button>
              ) : null}

              {canArchive ? (
                <button
                  type="button"
                  className="menu-item"
                  onClick={async () => {
                    closeActionsMenu();
                    await onArchiveGroup(group);
                  }}
                  disabled={busy || actionBusy}
                >
                  <span>Archive</span>
                  <span className="menu-item-meta">Hide from active</span>
                </button>
              ) : null}

              {canTrash ? (
                <button
                  type="button"
                  className="menu-item"
                  onClick={async () => {
                    closeActionsMenu();
                    await onTrashGroup(group);
                  }}
                  disabled={busy || actionBusy}
                >
                  <span>Move to trash</span>
                  <span className="menu-item-meta">Soft delete</span>
                </button>
              ) : null}

              {canCancel ? (
                <button
                  type="button"
                  className="menu-item danger"
                  onClick={() => {
                    closeActionsMenu();
                    setCancelOpen(true);
                  }}
                  disabled={busy || actionBusy}
                >
                  <span>Cancel request</span>
                  <span className="menu-item-meta">Stops the flow</span>
                </button>
              ) : null}

              {canDelete ? (
                <button
                  type="button"
                  className="menu-item danger"
                  onClick={() => {
                    closeActionsMenu();
                    setDeleteOpen(true);
                  }}
                  disabled={busy || actionBusy || !group?.flows?.length}
                >
                  <span>Delete permanently</span>
                  <span className="menu-item-meta">Remove from portal</span>
                </button>
              ) : null}
            </>
          );
        })()}
      </ContextMenu>

      <Modal
        open={bulkOpen}
        title={bulkMode === "restore" ? "Restore archived requests?" : "Archive requests?"}
        onClose={() => {
          if (actionBusy) return;
          setBulkOpen(false);
          setBulkCandidates([]);
        }}
        footer={
          <>
            <button
              type="button"
              onClick={() => {
                setBulkOpen(false);
                setBulkCandidates([]);
              }}
              disabled={busy || actionBusy}
            >
              Cancel
            </button>
            <button
              type="button"
              className={bulkMode === "restore" ? "primary" : "danger"}
              onClick={runBulk}
              disabled={busy || actionBusy || !bulkCandidates.length}
            >
              {actionBusy ? "Loading..." : bulkMode === "restore" ? "Restore" : "Archive"}
            </button>
          </>
        }
      >
        <EmptyState
          title={`${bulkCandidates.length} request(s) will be updated.`}
          description={
            bulkMode === "restore" ? "This returns requests to the active list." : "This moves completed or canceled requests out of the active list."
          }
        />
      </Modal>

      <Modal
        open={sendOpen}
        title={
          projectTitle
            ? `${sendKind === "fillSign" || sendKind === "sharedSign" ? "Request signature" : "New request"} - ${projectTitle}`
            : sendKind === "fillSign" || sendKind === "sharedSign"
              ? "Request signature"
              : "New request"
        }
        size="lg"
        onClose={requestCloseSend}
        footer={
          <>
             {!sendFlows.length ? (
               <>
                {sendDraftAvailable ? (
                  <button type="button" onClick={loadLastDraft} disabled={busy} title="Resume your last saved draft">
                    Continue draft
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={saveSendDraft}
                  disabled={busy || !sendSelectedId}
                  title={!sendSelectedId ? "Pick a template first" : "Save in this browser"}
                >
                  Save draft
                </button>
                {activeDraftId ? (
                  <button type="button" className="danger" onClick={clearDraftSelection} disabled={busy} title="Forget the currently loaded draft">
                    Clear draft
                  </button>
                ) : null}
                {sendStep === "recipients" ? (
                  <button type="button" onClick={() => setSendStep("setup")} disabled={busy}>
                    Back
                  </button>
                ) : (
                  <button type="button" onClick={requestCloseSend} disabled={busy}>
                    Cancel
                  </button>
                )}

                {sendStep === "setup" ? (
                  <button type="button" className="primary" onClick={() => setSendStep("recipients")} disabled={busy || !sendSelectedId}>
                    Next
                  </button>
                ) : (
                  <button
                    type="button"
                    className="primary"
                    onClick={onCreateFlow}
                    disabled={
                      busy ||
                      !sendSelectedId ||
                      ((sendKind === "fillSign" || sendKind === "sharedSign") && allRecipientEmails.length === 0)
                    }
                  >
                    {sendKind === "fillSign" || sendKind === "sharedSign" ? "Send for signature" : "Create request"}
                  </button>
                )}
              </>
            ) : (
              <>
                <button type="button" onClick={() => setSendOpen(false)} disabled={busy || notifyBusy}>
                  Close
                </button>
                {sendKind !== "fillSign" ? (
                  <button type="button" onClick={() => onCopyLink(sendFlow?.openUrl)} disabled={busy || notifyBusy || !sendFlow?.openUrl}>
                    Copy link
                  </button>
                ) : null}
                <button
                  type="button"
                  className="primary"
                  onClick={onNotifyRecipients}
                  disabled={busy || notifyBusy || !canManageProject || allRecipientEmails.length === 0}
                  title={!canManageProject ? "Only the project admin can notify people" : ""}
                >
                  {notifyBusy ? "Sending..." : notify ? "Notify people" : "Add people"}
                </button>
              </>
            )}
          </>
        }
      >
        <div className="wizard-modal">
          {!templateItems.length ? (
            <EmptyState
              title="No published templates in this project"
              description={
                activeProject?.title
                  ? `No published templates found in "${activeProject.title}". Publish a template to this project, or switch projects.`
                  : "Create a template, publish it to a project, then start a request."
              }
              actions={
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button type="button" className="primary" onClick={onOpenDrafts} disabled={busy}>
                    Open Templates
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      window.dispatchEvent(new CustomEvent("portal:templatesChanged"));
                      window.dispatchEvent(new CustomEvent("portal:projectChanged"));
                    }}
                    disabled={busy}
                  >
                    Refresh
                  </button>
                  <button type="button" onClick={onOpenProjects} disabled={busy}>
                    Change project
                  </button>
                </div>
              }
            />
          ) : (
            <div className="request-wizard">
            {!sendFlows.length ? (
              <div className="wizard-stepper" aria-label="New request steps">
                <button
                  type="button"
                  className={`wizard-step${sendStep === "setup" ? " is-active" : ""}`}
                  onClick={() => setSendStep("setup")}
                  disabled={busy}
                >
                  1. Template
                </button>
                <span className="wizard-step-sep" aria-hidden="true" />
                <button
                  type="button"
                  className={`wizard-step${sendStep === "recipients" ? " is-active" : ""}`}
                  onClick={() => setSendStep("recipients")}
                  disabled={busy || !sendSelectedId}
                  title={!sendSelectedId ? "Choose a template first" : ""}
                >
                  2. Recipients
                </button>
              </div>
            ) : null}
            {!sendFlows.length && sendStep === "setup" ? (
              <>
            <div className="wizard-section">
              <div className="wizard-head">
                <strong>Request type</strong>
                <span className="muted">Choose what recipients should do.</span>
              </div>
              <div className="chip-row">
                <button
                  type="button"
                  className={`chip${sendKind === "approval" ? " is-active" : ""}`}
                  onClick={() => setSendKind("approval")}
                  disabled={busy}
                >
                  Approval
                </button>
                <button
                  type="button"
                  className={`chip${sendKind === "fillSign" ? " is-active" : ""}`}
                  onClick={() => setSendKind("fillSign")}
                  disabled={busy}
                >
                  Fill &amp; Sign
                </button>
                <button
                  type="button"
                  className={`chip${sendKind === "sharedSign" ? " is-active" : ""}`}
                  onClick={() => setSendKind("sharedSign")}
                  disabled={busy}
                >
                  Contract (one document)
                </button>
              </div>

              <div className="wizard-divider" aria-hidden="true" />

              <div className="wizard-section">
                <div className="wizard-head">
                  <strong>Due date (optional)</strong>
                  <span className="muted">Helps track overdue requests.</span>
                </div>
                <div className="request-due">
                  <input
                    type="date"
                    value={sendDueDate}
                    onChange={(e) => setSendDueDate(e.target.value)}
                    disabled={busy}
                  />
                  <div className="chip-row">
                    <button
                      type="button"
                      className="chip"
                      onClick={() => {
                        const d = new Date();
                        d.setDate(d.getDate() + 1);
                        setSendDueDate(d.toISOString().slice(0, 10));
                      }}
                      disabled={busy}
                    >
                      Tomorrow
                    </button>
                    <button
                      type="button"
                      className="chip"
                      onClick={() => {
                        const d = new Date();
                        d.setDate(d.getDate() + 3);
                        setSendDueDate(d.toISOString().slice(0, 10));
                      }}
                      disabled={busy}
                    >
                      3 days
                    </button>
                    <button
                      type="button"
                      className="chip"
                      onClick={() => {
                        const d = new Date();
                        d.setDate(d.getDate() + 7);
                        setSendDueDate(d.toISOString().slice(0, 10));
                      }}
                      disabled={busy}
                    >
                      7 days
                    </button>
                    {sendDueDate ? (
                      <button type="button" className="link" onClick={() => setSendDueDate("")} disabled={busy}>
                        Clear
                      </button>
                    ) : null}
                  </div>
                </div>
                <p className="muted" style={{ margin: 0 }}>
                  Only in-progress requests can become overdue.
                </p>
              </div>
              <p className="muted" style={{ margin: "10px 0 0" }}>
                {sendKind === "fillSign"
                  ? "Creates a signing request for each selected recipient. Each person signs their own copy."
                  : sendKind === "sharedSign"
                    ? "Creates one shared document in the project signing room. Everyone signs the same file."
                  : "Creates a shareable link you can send to recipients."}
              </p>
            </div>
            <div className="wizard-section" data-tour="requests:wizard:template">
              <div className="wizard-head">
                <strong>1) Choose a template</strong>
                {sendSelectedTitle ? <span className="muted truncate">Selected: {sendSelectedTitle}</span> : null}
              </div>
              <div className="auth-form" style={{ marginTop: 0 }}>
                <label>
                  <span>Template</span>
                  <input
                    value={sendQuery}
                    onChange={(e) => setSendQuery(e.target.value)}
                    placeholder="Search templates..."
                    disabled={busy}
                  />
                </label>
              </div>
              <div className="template-picker" style={{ marginTop: 0 }}>
                <div className="template-picker-meta">
                  <span className="muted">{filteredSendTemplates.length} shown</span>
                  {sendSelectedId ? (
                    <button
                      type="button"
                      className="link"
                      onClick={() => {
                        setSendSelectedId("");
                        setSendSelectedTitle("");
                      }}
                      disabled={busy}
                    >
                      Clear selection
                    </button>
                  ) : null}
                </div>

                {!filteredSendTemplates.length ? (
                  <EmptyState
                    title="No templates found"
                    description={sendQuery ? "Try a different search, or publish another template." : "Publish a PDF template to this project to start a request."}
                  />
                ) : (
                  <div className="template-picker-list list" role="listbox" aria-label="Templates">
                    {filteredSendTemplates.map((t) => {
                      const selected = String(sendSelectedId) === String(t.id);
                      const title = t.title || `File ${t.id}`;
                      const kind = t.isForm ? "Form" : "PDF";
                      return (
                        <button
                          key={t.id}
                          type="button"
                          className={`list-row template-row${selected ? " is-selected" : ""}`}
                          onClick={() => {
                            setSendSelectedId(String(t.id));
                            setSendSelectedTitle(String(title));
                          }}
                          disabled={busy}
                          role="option"
                          aria-selected={selected}
                          title={title}
                        >
                          <span className="list-main" style={{ minWidth: 0 }}>
                            <strong className="truncate">{title}</strong>
                          </span>
                          <span className="template-row-right" aria-hidden="true">
                            <StatusPill tone={t.isForm ? "green" : "gray"}>{kind}</StatusPill>
                            <span className="template-row-check">{selected ? "✓" : ""}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
              </>
            ) : null}

            {(!sendFlows.length && sendStep === "recipients") || sendFlows.length ? <div className="wizard-divider" /> : null}

            {!sendFlows.length && sendStep === "recipients" ? (
                <div className="wizard-section" data-tour="requests:wizard:recipients">
                  <div className="wizard-head">
                    <div style={{ display: "grid", gap: 2 }}>
                      <strong>2) Recipients {sendKind === "fillSign" || sendKind === "sharedSign" ? "" : "(optional)"}</strong>
                      <span className="muted">
                        {sendKind === "fillSign" || sendKind === "sharedSign"
                          ? "Pick at least one person to sign."
                          : "Pick people to notify, or invite new people to this project."}
                      </span>
                    </div>
                    {canManageProject ? (
                      <button
                        type="button"
                        className="link"
                        onClick={() => setSendAdvanced((v) => !v)}
                        disabled={busy}
                        title="Invite people by email and add a message"
                      >
                        {sendAdvanced ? "Hide options" : "Invite & message"}
                      </button>
                    ) : null}
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <span className="muted">{allRecipientEmails.length} selected</span>
                    {allRecipientEmails.length ? (
                      <button
                        type="button"
                        className="link"
                        onClick={() => {
                          setPickedMemberIds(new Set());
                          setPickedDirectoryEmails(new Set());
                          setInviteEmails("");
                        }}
                        disabled={busy}
                      >
                        Clear recipients
                      </button>
                    ) : null}
                  </div>

                {membersLoading ? (
                  <EmptyState title="Loading people..." />
                ) : (
                  <div className="recipient-grid">
                    <div className="recipient-panel">
                      <div className="recipient-head">
                        <strong>People in this project</strong>
                        <span className="muted">{projectMembers.length} total</span>
                      </div>
                      <div className="auth-form" style={{ marginTop: 0 }}>
                        <label>
                          <span>Search</span>
                          <input
                            value={memberQuery}
                            onChange={(e) => setMemberQuery(e.target.value)}
                            placeholder="Search people..."
                            disabled={busy}
                          />
                        </label>
                      </div>

                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginTop: -4 }}>
                        <span className="muted">{pickedMemberIds.size} selected</span>
                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                          <button
                            type="button"
                            className="link"
                            onClick={() => {
                              const next = new Set(pickedMemberIds);
                              for (const m of filteredProjectMembers) next.add(m.id);
                              setPickedMemberIds(next);
                            }}
                            disabled={busy || filteredProjectMembers.length === 0}
                          >
                            Select all shown
                          </button>
                          {pickedMemberIds.size ? (
                            <button
                              type="button"
                              className="link"
                              onClick={() => {
                                const next = new Set(pickedMemberIds);
                                for (const m of filteredProjectMembers) next.delete(m.id);
                                setPickedMemberIds(next);
                              }}
                              disabled={busy || filteredProjectMembers.length === 0}
                            >
                              Clear shown
                            </button>
                          ) : null}
                        </div>
                      </div>

                      {membersError ? <p className="error" style={{ margin: 0 }}>{membersError}</p> : null}
                      {!projectMembers.length ? (
                        <EmptyState title="No people found" description="Invite someone to this project to notify them." />
                      ) : !filteredProjectMembers.length ? (
                        <EmptyState title="No matches" description="Try a different search." />
                      ) : (
                        <div className="member-list is-compact" role="listbox" aria-label="Project people" aria-multiselectable="true">
                          {filteredProjectMembers.map((m) => {
                            const selected = pickedMemberIds.has(m.id);
                            return (
                              <button
                                key={m.id}
                                type="button"
                                className={`select-row${selected ? " is-selected" : ""}`}
                                onClick={() => {
                                  const next = new Set(pickedMemberIds);
                                  if (selected) next.delete(m.id);
                                  else next.add(m.id);
                                  setPickedMemberIds(next);
                                }}
                                disabled={busy}
                                role="option"
                                aria-selected={selected}
                                title={m.email ? `${m.name} — ${m.email}` : m.name}
                              >
                                <div className="select-row-main">
                                  <strong className="truncate">{m.name}</strong>
                                  <span className="muted truncate">
                                    {m.email ? m.email : "No email"}
                                    {m.isOwner ? " (Admin)" : ""}
                                  </span>
                                </div>
                                <span className="select-row-right" aria-hidden="true">
                                  {selected ? "✓" : ""}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                      {!canManageProject ? (
                        <p className="muted" style={{ margin: 0 }}>
                          Only the project admin can send notifications or invite new people.
                        </p>
                      ) : null}
                    </div>

                    <div className="recipient-panel">
                      <div className="recipient-head">
                        <strong>Contacts</strong>
                        <span className="muted">{directoryRows.length} shown</span>
                      </div>

                      <Tabs
                        value={dirMode}
                        onChange={(v) => {
                          setDirMode(String(v || "people"));
                          setDirectoryError("");
                        }}
                        items={[
                          { id: "people", label: "People" },
                          { id: "groups", label: "Groups" }
                        ]}
                        ariaLabel="Contacts source"
                      />

                      <div className="auth-form" style={{ marginTop: 0 }}>
                        {dirMode === "people" ? (
                          <label>
                            <span>People</span>
                            <input
                              value={dirPeopleQuery}
                              onChange={(e) => setDirPeopleQuery(e.target.value)}
                              placeholder="Filter or search name/email..."
                              disabled={busy || directoryLoading}
                            />
                          </label>
                        ) : (
                          <label>
                            <span>Groups</span>
                            <input
                              value={dirGroupQuery}
                              onChange={(e) => setDirGroupQuery(e.target.value)}
                              placeholder="Filter groups..."
                              disabled={busy || directoryLoading}
                            />
                          </label>
                        )}
                      </div>

                      {dirMode === "groups" ? (
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginTop: -4 }}>
                          <span className="muted">{dirSelectedGroupIds instanceof Set ? dirSelectedGroupIds.size : 0} selected</span>
                          {(dirSelectedGroupIds instanceof Set ? dirSelectedGroupIds.size : 0) ? (
                            <button
                              type="button"
                              className="link"
                              onClick={() => setDirSelectedGroupIds(new Set())}
                              disabled={busy || directoryLoading}
                            >
                              Clear groups
                            </button>
                          ) : null}
                        </div>
                      ) : null}

                      {directoryError ? <p className="error" style={{ margin: 0 }}>{directoryError}</p> : null}
                      {directoryLoading ? <EmptyState title="Loading directory..." /> : null}

                      {!directoryLoading && dirMode === "people" && !String(dirPeopleQuery || "").trim() && directoryRows.length === 0 ? (
                        <EmptyState title="No people found" description="The directory is empty, or this user has no access." />
                      ) : null}

                      {!directoryLoading && dirMode === "groups" && (dirSelectedGroupIds instanceof Set ? dirSelectedGroupIds.size : 0) === 0 ? (
                        <EmptyState title="Choose groups" description="Select one or more groups, then pick recipients from their members." />
                      ) : null}

                      {!directoryLoading && dirMode === "people" && String(dirPeopleQuery || "").trim() && directoryRows.length === 0 ? (
                        <EmptyState title="No results" description="Try a different search." />
                      ) : null}

                      {!directoryLoading && dirMode === "groups" && (dirSelectedGroupIds instanceof Set ? dirSelectedGroupIds.size : 0) > 0 && directoryRows.length === 0 ? (
                        <EmptyState title="No members found" description="Selected groups have no members with email addresses." />
                      ) : null}

                      {!directoryLoading && dirMode === "groups" && filteredDirGroups.length ? (
                        <>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginTop: -4 }}>
                            <span className="muted">{dirSelectedGroupIds instanceof Set ? dirSelectedGroupIds.size : 0} selected</span>
                            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                              <button
                                type="button"
                                className="link"
                                onClick={() => {
                                  const next = new Set(dirSelectedGroupIds instanceof Set ? dirSelectedGroupIds : []);
                                  for (const g of filteredDirGroups) {
                                    const gid = String(g?.id || "").trim();
                                    if (gid) next.add(gid);
                                  }
                                  setDirSelectedGroupIds(next);
                                }}
                                disabled={busy || directoryLoading || filteredDirGroups.length === 0}
                              >
                                Select all shown
                              </button>
                              {(dirSelectedGroupIds instanceof Set ? dirSelectedGroupIds.size : 0) ? (
                                <button type="button" className="link" onClick={() => setDirSelectedGroupIds(new Set())} disabled={busy || directoryLoading}>
                                  Clear
                                </button>
                              ) : null}
                            </div>
                          </div>

                          <div className="member-list is-compact" style={{ marginTop: 4 }} role="listbox" aria-label="Groups" aria-multiselectable="true">
                            {filteredDirGroups.map((g) => {
                              const gid = String(g?.id || "").trim();
                              if (!gid) return null;
                              const name = String(g?.name || "").trim() || "Group";
                              const count = Number.isFinite(Number(g?.membersCount)) ? Number(g.membersCount) : null;
                              const selected = dirSelectedGroupIds instanceof Set ? dirSelectedGroupIds.has(gid) : false;
                              const isLoading = dirGroupLoadingIds instanceof Set ? dirGroupLoadingIds.has(gid) : false;
                              return (
                                <button
                                  key={gid}
                                  type="button"
                                  className={`select-row${selected ? " is-selected" : ""}`}
                                  onClick={() => toggleDirectoryGroup(gid)}
                                  disabled={busy || directoryLoading || isLoading}
                                  role="option"
                                  aria-selected={selected}
                                  title={name}
                                >
                                  <div className="select-row-main">
                                    <strong className="truncate">{name}</strong>
                                    <span className="muted truncate">
                                      {count !== null ? `${count} members` : "Group"}
                                      {isLoading ? " — loading…" : ""}
                                    </span>
                                  </div>
                                  <span className="select-row-right" aria-hidden="true">
                                    {selected ? "✓" : ""}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </>
                      ) : null}

                      {!directoryLoading && directoryRows.length ? (
                        <>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginTop: -4 }}>
                            <span className="muted">{pickedDirectoryEmails.size} selected</span>
                            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                              <button
                                type="button"
                                className="link"
                                onClick={() => {
                                  const emails = directoryRows.map((r) => r.email).filter(Boolean);
                                  const next = new Set(pickedDirectoryEmails);
                                  for (const email of emails) next.add(email);
                                  setPickedDirectoryEmails(next);
                                }}
                                disabled={busy || directoryRows.length === 0}
                              >
                                Select all shown
                              </button>
                              {pickedDirectoryEmails.size ? (
                                <button
                                  type="button"
                                  className="link"
                                  onClick={() => setPickedDirectoryEmails(new Set())}
                                  disabled={busy}
                                >
                                  Clear
                                </button>
                              ) : null}
                            </div>
                          </div>

                          <div className="member-list is-compact" role="listbox" aria-label="Contacts" aria-multiselectable="true">
                            {directoryRows.map((c) => {
                              const email = String(c?.email || "").trim().toLowerCase();
                              if (!email) return null;
                              const name = String(c?.name || "").trim() || email;
                              const selected = pickedDirectoryEmails.has(email);
                              return (
                                <button
                                  key={`${dirMode}:${email}`}
                                  type="button"
                                  className={`select-row${selected ? " is-selected" : ""}`}
                                  onClick={() => {
                                    const next = new Set(pickedDirectoryEmails);
                                    if (selected) next.delete(email);
                                    else next.add(email);
                                    setPickedDirectoryEmails(next);
                                  }}
                                  disabled={busy}
                                  role="option"
                                  aria-selected={selected}
                                  title={email}
                                >
                                  <div className="select-row-main">
                                    <strong className="truncate">{name}</strong>
                                    <span className="muted truncate">{email}</span>
                                  </div>
                                  <span className="select-row-right" aria-hidden="true">
                                    {selected ? "✓" : ""}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </>
                      ) : null}

                      {!directoryLoading &&
                      dirMode === "people" &&
                      !String(dirPeopleQuery || "").trim() &&
                      dirPeopleTotal > 0 &&
                      Array.isArray(dirPeople) &&
                      dirPeople.length < dirPeopleTotal ? (
                        <div style={{ display: "flex", gap: 12, alignItems: "center", paddingTop: 8 }}>
                          <button
                            type="button"
                            onClick={() => {
                              if (!token) return;
                              setDirectoryLoading(true);
                              setDirectoryError("");
                              listDirectoryPeople({ token, limit: 25, offset: dirPeople.length })
                                .then((data) => {
                                  const list = Array.isArray(data?.people) ? data.people : [];
                                  const total = Number.isFinite(Number(data?.total)) ? Number(data.total) : dirPeopleTotal;
                                  setDirPeople((prev) => [...(Array.isArray(prev) ? prev : []), ...list]);
                                  setDirPeopleTotal(total);
                                })
                                .catch((e) => setDirectoryError(e?.message || "Failed to load people"))
                                .finally(() => setDirectoryLoading(false));
                            }}
                            disabled={busy || directoryLoading}
                          >
                            Load more
                          </button>
                          <span className="muted">
                            Showing {dirPeople.length} of {dirPeopleTotal}
                          </span>
                        </div>
                      ) : null}

                      <p className="muted" style={{ margin: 0 }}>
                        Selected people are added as recipient emails.
                      </p>
                    </div>
                  </div>
                )}

                {sendAdvanced && canManageProject ? (
                  <div className="recipient-panel" style={{ marginTop: 12 }}>
                    <div className="recipient-head">
                      <strong>Invite & message</strong>
                      <span className="muted">Admin only</span>
                    </div>
                    <div className="auth-form" style={{ marginTop: 0 }}>
                      <label>
                        <span>Emails</span>
                        <EmailChipsInput
                          value={inviteEmails}
                          onChange={setInviteEmails}
                          placeholder="Type an email and press Enter"
                          disabled={busy || !canManageProject}
                        />
                      </label>
                      <label className="inline-check">
                        <input
                          type="checkbox"
                          checked={Boolean(notify)}
                          onChange={(e) => setNotify(e.target.checked)}
                          disabled={busy || !canManageProject}
                        />
                        <span>Send notification</span>
                      </label>
                      <label>
                        <span>Message (optional)</span>
                        <input
                          value={notifyMessage}
                          onChange={(e) => setNotifyMessage(e.target.value)}
                          disabled={busy || !canManageProject || !notify}
                          placeholder="Short note for recipients..."
                        />
                      </label>
                      <p className="muted" style={{ margin: 0 }}>
                        {sendKind === "fillSign"
                          ? "After sending, people will see the document in their Requests inbox."
                          : sendKind === "sharedSign"
                            ? "After sending, people will open the shared signing link."
                            : "After creating the request you can notify people and include the approval link."}
                      </p>
                    </div>
                  </div>
                ) : null}

                {(sendKind === "sharedSign" || sendKind === "approval") && allRecipientEmails.length > 1 ? (
                  <div className="order-block">
                    <label className="inline-check" style={{ marginTop: 2 }}>
                      <input
                        type="checkbox"
                        checked={Boolean(orderEnabled)}
                        onChange={(e) => {
                          const checked = Boolean(e.target.checked);
                          setOrderEnabled(checked);
                          if (checked && (Number(orderMaxStep) || 0) < 2) setOrderMaxStep(2);
                        }}
                        disabled={busy}
                      />
                      <span>{sendKind === "sharedSign" ? "Signing order (steps)" : "Approval order (steps)"}</span>
                    </label>
                    <p className="muted" style={{ margin: "0 0 10px" }}>
                      {sendKind === "sharedSign"
                        ? "Step 1 signs first. When everyone in a step completes, the next step gets the document."
                        : "Step 1 approves first. When everyone in a step completes, the next step starts."}
                    </p>

                    {orderEnabled ? (
                      <>
                        <div className="order-list">
                          {allRecipientEmails.map((raw) => {
                            const email = String(raw || "").trim();
                            const key = email.toLowerCase();
                            const value = Number(orderMap?.[key] || 1);
                            return (
                              <div key={key} className="order-row">
                                <span className="truncate" title={email}>{email}</span>
                                <select
                                  value={Number.isFinite(value) ? value : 1}
                                  onChange={(e) => {
                                    const next = Number(e.target.value) || 1;
                                    setOrderMap((prev) => ({ ...(prev || {}), [key]: next }));
                                  }}
                                  disabled={busy}
                                >
                                  {Array.from({ length: Math.max(2, Number(orderMaxStep) || 2) }, (_, i) => i + 1).map((n) => (
                                    <option key={n} value={n}>
                                      Step {n}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            );
                          })}
                        </div>
                        <div className="row-actions" style={{ justifyContent: "space-between", marginTop: 10 }}>
                          <button
                            type="button"
                            onClick={() => setOrderMaxStep((v) => Math.min(6, Math.max(2, Number(v) || 2) + 1))}
                            disabled={busy || Number(orderMaxStep) >= 6}
                          >
                            Add step
                          </button>
                          <button
                            type="button"
                            className="link"
                            onClick={() => {
                              setOrderMaxStep(2);
                              setOrderMap({});
                            }}
                            disabled={busy}
                          >
                            Reset
                          </button>
                        </div>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            {sendFlows.length ? (
              <div className="wizard-section">
                <div className="wizard-head">
                  <strong>Request created</strong>
                  <span className="muted">
                    {sendKind === "fillSign"
                      ? "Recipients can sign from their Requests inbox."
                      : sendKind === "sharedSign"
                        ? "Copy the signing link or notify people from this project."
                        : "Copy the link or notify people from this project."}
                  </span>
                </div>
                {sendWarning ? <p className="notice">{sendWarning}</p> : null}
                <div className="auth-form" style={{ marginTop: 0 }}>
                  {sendKind !== "fillSign" ? (
                    <>
                      <label>
                        <span>{sendKind === "sharedSign" ? "Signing link" : "Approval link"}</span>
                        <input value={String(sendFlow?.openUrl || "")} readOnly />
                      </label>
                      {sendKind === "sharedSign" ? (
                        <p className="muted" style={{ margin: "0 0 10px" }}>
                          Stored in{" "}
                          <strong>{String(sendFlow?.documentRoomTitle || "Signing room")}</strong>.
                        </p>
                      ) : null}
                      <div className="row-actions" style={{ justifyContent: "flex-start", marginTop: 0 }}>
                        <button type="button" onClick={() => onCopyLink(sendFlow?.openUrl)} disabled={busy || notifyBusy || !sendFlow?.openUrl}>
                          Copy link
                        </button>
                        {sendKind === "sharedSign" && sendFlow?.documentRoomUrl ? (
                          <a className="btn" href={String(sendFlow.documentRoomUrl)} target="_blank" rel="noreferrer">
                            Open room
                          </a>
                        ) : null}
                        <button
                          type="button"
                          className="primary"
                          onClick={onNotifyRecipients}
                          disabled={busy || notifyBusy || !canManageProject || allRecipientEmails.length === 0}
                          title={!canManageProject ? "Only the project admin can notify people" : ""}
                        >
                          {notifyBusy ? "Sending..." : notify ? `Notify (${allRecipientEmails.length})` : `Add (${allRecipientEmails.length})`}
                        </button>
                        <button type="button" className="link" onClick={onOpenDrafts} disabled={busy || notifyBusy}>
                          Templates
                        </button>
                      </div>
                      <p className="muted" style={{ margin: 0 }}>
                        Recipients: {allRecipientEmails.length ? allRecipientEmails.join(", ") : "none"}.
                      </p>
                    </>
                  ) : (
                    <>
                      <label>
                        <span>Signing link</span>
                        <input value={String(sendFlow?.openUrl || "")} readOnly />
                      </label>
                      <div className="row-actions" style={{ justifyContent: "flex-start", marginTop: 0 }}>
                        <button type="button" onClick={() => onCopyLink(sendFlow?.openUrl)} disabled={busy || notifyBusy || !sendFlow?.openUrl}>
                          Copy link
                        </button>
                      </div>
                      <p className="muted" style={{ margin: 0 }}>
                        Recipients: {allRecipientEmails.length ? allRecipientEmails.join(", ") : "none"}.
                      </p>
                      <div className="row-actions" style={{ justifyContent: "flex-start", marginTop: 0 }}>
                        <button
                          type="button"
                          className="primary"
                          onClick={onNotifyRecipients}
                          disabled={busy || notifyBusy || !canManageProject || allRecipientEmails.length === 0}
                          title={!canManageProject ? "Only the project admin can notify people" : ""}
                        >
                          {notifyBusy ? "Sending..." : notify ? `Notify (${allRecipientEmails.length})` : `Add (${allRecipientEmails.length})`}
                        </button>
                        <button type="button" className="link" onClick={onOpenDrafts} disabled={busy || notifyBusy}>
                          Templates
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            ) : null}
            </div>
          )}
        </div>
      </Modal>

      <Modal
        open={sendExitConfirmOpen}
        title="Save draft?"
        onClose={() => setSendExitConfirmOpen(false)}
        size="sm"
        footer={
          <>
            <button type="button" onClick={() => setSendExitConfirmOpen(false)} disabled={busy || notifyBusy}>
              Continue editing
            </button>
            <button
              type="button"
              onClick={() => {
                setSendExitConfirmOpen(false);
                setSendOpen(false);
              }}
              disabled={busy || notifyBusy}
            >
              Discard
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => {
                saveSendDraft();
                setSendExitConfirmOpen(false);
                setSendOpen(false);
              }}
              disabled={busy || notifyBusy || !sendSelectedId}
              title={!sendSelectedId ? "Pick a template first" : ""}
            >
              Save draft
            </button>
          </>
        }
      >
        <p className="muted" style={{ margin: 0 }}>
          You have an unfinished request. Save it as a draft to continue later, or discard your changes.
        </p>
      </Modal>

      <Modal
        open={actionsOpen}
        title={(() => {
          const flow = actionsGroup?.primaryFlow || actionsGroup?.flows?.[0] || null;
          const title = flow?.fileTitle || flow?.templateTitle || "";
          return title || "Request";
        })()}
        size="sm"
        onClose={() => {
          setActionsOpen(false);
          setActionsGroup(null);
        }}
      >
        {(() => {
          const group = actionsGroup;
          const flow = group?.primaryFlow || group?.flows?.[0] || null;
          if (!flow) return null;

          const status = String(group?.status || flow?.status || "");
          const kind = normalizeKind(flow?.kind);
          const canManage = canManageFlow(flow);
          const isArchived = Boolean(flow?.archivedAt);
          const isTrashed = Boolean(flow?.trashedAt);
          const canReopen = status === "Canceled" && canManage;
          const canCancel = canManage && status === "InProgress";
          const canComplete =
            kind === "sharedSign" &&
            status !== "Completed" &&
            status !== "Canceled" &&
            Boolean(isAssignedToMe(flow) || canManage);
          const canArchive = canManage && !isArchived && (status === "Completed" || status === "Canceled");
          const canUnarchive = canManage && isArchived;
          const canTrash = canManage && !isTrashed && (status === "Completed" || status === "Canceled" || isArchived);
          const canUntrash = canManage && isTrashed;

          const openUrl = String((status === "Completed" ? flow?.resultFileUrl || flow?.openUrl : flow?.openUrl) || "").trim();
          const canOpen = Boolean(openUrl) && status !== "Canceled";
          const openLabel = status === "Completed" ? "Open result" : "Open";

          const canCopyLink = Boolean(openUrl) && kind !== "fillsign";

          return (
            <div className="modal-actions">
              <div className="action-list" role="menu" aria-label="Request actions">
                <button
                  type="button"
                  className="action-item primary"
                  onClick={() => {
                    openFlow(flow);
                    setActionsOpen(false);
                    setActionsGroup(null);
                  }}
                  disabled={!canOpen || busy || actionBusy}
                  role="menuitem"
                >
                  <div className="action-item-text">
                    <strong>{openLabel}</strong>
                    <span className="muted">{status === "Completed" ? "View the final file." : "Open the request file."}</span>
                  </div>
                  <span className="action-item-right" aria-hidden="true">&gt;</span>
                </button>

                <button
                  type="button"
                  className="action-item"
                  onClick={() => {
                    setDetailsGroup(group);
                    setDetailsOpen(true);
                    setActionsOpen(false);
                  }}
                  disabled={busy || actionBusy || !flow?.id}
                  role="menuitem"
                >
                  <div className="action-item-text">
                    <strong>Details</strong>
                    <span className="muted">Recipients, due date, link.</span>
                  </div>
                  <span className="action-item-right" aria-hidden="true">&gt;</span>
                </button>

                <button
                  type="button"
                  className="action-item"
                  onClick={() => {
                    setAuditOpen(true);
                    setActionsOpen(false);
                  }}
                  disabled={busy || actionBusy || !flow?.id}
                  role="menuitem"
                >
                  <div className="action-item-text">
                    <strong>Activity</strong>
                    <span className="muted">Timeline of changes.</span>
                  </div>
                  <span className="action-item-right" aria-hidden="true">&gt;</span>
                </button>

                {canCopyLink ? (
                  <button
                    type="button"
                    className="action-item"
                    onClick={() => onCopyLink(openUrl)}
                    disabled={busy || actionBusy || !openUrl}
                    role="menuitem"
                  >
                    <div className="action-item-text">
                      <strong>Copy link</strong>
                      <span className="muted">Share with recipients.</span>
                    </div>
                    <span className="action-item-right" aria-hidden="true">&gt;</span>
                  </button>
                ) : null}

                {canComplete ? (
                  <button
                    type="button"
                    className="action-item"
                    onClick={() => {
                      setActionsOpen(false);
                      setCompleteOpen(true);
                    }}
                    disabled={busy || actionBusy}
                    role="menuitem"
                  >
                    <div className="action-item-text">
                      <strong>Complete</strong>
                      <span className="muted">Mark your signing step done.</span>
                    </div>
                    <span className="action-item-right" aria-hidden="true">&gt;</span>
                  </button>
                ) : null}

                {canReopen ? (
                  <button
                    type="button"
                    className="action-item"
                    onClick={async () => {
                      setActionsOpen(false);
                      await onReopenGroup(group);
                    }}
                    disabled={busy || actionBusy}
                    role="menuitem"
                  >
                    <div className="action-item-text">
                      <strong>Reopen request</strong>
                      <span className="muted">Undo cancel and continue.</span>
                    </div>
                    <span className="action-item-right" aria-hidden="true">&gt;</span>
                  </button>
                ) : null}

                {canArchive ? (
                  <button
                    type="button"
                    className="action-item"
                    onClick={async () => {
                      setActionsOpen(false);
                      await onArchiveGroup(group);
                    }}
                    disabled={busy || actionBusy}
                    role="menuitem"
                  >
                    <div className="action-item-text">
                      <strong>Archive request</strong>
                      <span className="muted">Moves it out of the active list.</span>
                    </div>
                    <span className="action-item-right" aria-hidden="true">&gt;</span>
                  </button>
                ) : null}

                {canUnarchive ? (
                  <button
                    type="button"
                    className="action-item"
                    onClick={async () => {
                      setActionsOpen(false);
                      await onUnarchiveGroup(group);
                    }}
                    disabled={busy || actionBusy}
                    role="menuitem"
                  >
                    <div className="action-item-text">
                      <strong>Restore from archive</strong>
                      <span className="muted">Returns it to the active list.</span>
                    </div>
                    <span className="action-item-right" aria-hidden="true">&gt;</span>
                  </button>
                ) : null}

                {canTrash ? (
                  <button
                    type="button"
                    className="action-item"
                    onClick={async () => {
                      setActionsOpen(false);
                      await onTrashGroup(group);
                    }}
                    disabled={busy || actionBusy}
                    role="menuitem"
                  >
                    <div className="action-item-text">
                      <strong>Move to trash</strong>
                      <span className="muted">Hide it from lists. You can restore later.</span>
                    </div>
                    <span className="action-item-right" aria-hidden="true">&gt;</span>
                  </button>
                ) : null}

                {canUntrash ? (
                  <button
                    type="button"
                    className="action-item"
                    onClick={async () => {
                      setActionsOpen(false);
                      await onUntrashGroup(group);
                    }}
                    disabled={busy || actionBusy}
                    role="menuitem"
                  >
                    <div className="action-item-text">
                      <strong>Restore from trash</strong>
                      <span className="muted">Returns it to your lists.</span>
                    </div>
                    <span className="action-item-right" aria-hidden="true">&gt;</span>
                  </button>
                ) : null}

                {canCancel ? (
                  <button
                    type="button"
                    className="action-item danger"
                    onClick={() => {
                      setActionsOpen(false);
                      setCancelOpen(true);
                    }}
                    disabled={busy || actionBusy || !group?.flows?.length}
                    role="menuitem"
                  >
                    <div className="action-item-text">
                      <strong>Cancel request</strong>
                      <span className="muted">Stops the request in this portal.</span>
                    </div>
                    <span className="action-item-right" aria-hidden="true">&gt;</span>
                  </button>
                ) : null}
              </div>
            </div>
          );
        })()}
      </Modal>

      <AuditModal
        open={auditOpen}
        onClose={() => setAuditOpen(false)}
        token={token}
        flowId={(actionsGroup?.primaryFlow || actionsGroup?.flows?.[0])?.id}
        title={(() => {
          const flow = actionsGroup?.primaryFlow || actionsGroup?.flows?.[0] || null;
          const t = flow?.fileTitle || flow?.templateTitle || "";
          return t ? `Activity: ${t}` : "Activity";
        })()}
      />

      <Modal
        open={completeOpen}
        title="Mark as complete?"
        onClose={() => setCompleteOpen(false)}
        footer={
          <>
            <button type="button" onClick={() => setCompleteOpen(false)} disabled={busy || actionBusy}>
              Cancel
            </button>
            <button
              type="button"
              className="primary"
              onClick={async () => {
                const flow = actionsGroup?.primaryFlow || actionsGroup?.flows?.[0] || null;
                setCompleteOpen(false);
                setActionsOpen(false);
                setActionsGroup(null);
                await onComplete(flow);
              }}
              disabled={busy || actionBusy || !(actionsGroup?.primaryFlow || actionsGroup?.flows?.[0])?.id}
            >
              {actionBusy ? "Loading..." : "Complete"}
            </button>
          </>
        }
      >
        <EmptyState
          title="Confirm that you finished signing."
          description="This updates the status in the portal for your recipient entry."
        />
      </Modal>

      <Modal
        open={deleteOpen}
        title="Delete request permanently?"
        onClose={() => setDeleteOpen(false)}
        footer={
          <>
            <button type="button" onClick={() => setDeleteOpen(false)} disabled={busy || actionBusy}>
              Keep
            </button>
            <button
              type="button"
              className="danger"
              onClick={async () => {
                const group = actionsGroup;
                setDeleteOpen(false);
                setActionsGroup(null);
                await onDeleteGroupPermanently(group);
              }}
              disabled={busy || actionBusy || !actionsGroup?.flows?.length}
            >
              {actionBusy ? "Loading..." : "Delete"}
            </button>
          </>
        }
      >
        <EmptyState title="This removes the request from portal lists." description="Files and room access stay unchanged." />
      </Modal>

      <Modal
        open={cancelOpen}
        title="Cancel request?"
        onClose={() => setCancelOpen(false)}
        footer={
          <>
            <button type="button" onClick={() => setCancelOpen(false)} disabled={busy || actionBusy}>
              Keep
            </button>
            <button
              type="button"
              className="danger"
              onClick={async () => {
                const group = actionsGroup;
                setCancelOpen(false);
                setActionsOpen(false);
                setActionsGroup(null);
                await onCancelGroup(group);
              }}
              disabled={busy || actionBusy || !actionsGroup?.flows?.length}
            >
              {actionBusy ? "Loading..." : "Cancel request"}
            </button>
          </>
        }
      >
        <EmptyState title="This marks the request as canceled in the portal." description="It won't delete any files or revoke access." />
      </Modal>

      <RequestDetailsModal
        open={detailsOpen}
        onClose={() => {
          setDetailsOpen(false);
          setDetailsGroup(null);
        }}
        busy={busy || actionBusy}
        group={detailsGroup}
        roomTitleById={roomTitleById}
        onOpen={(flow) => openFlow(flow)}
        onCopyLink={(url) => onCopyLink(url)}
        onNotify={(() => {
          const flow = detailsGroup?.primaryFlow || detailsGroup?.flows?.[0] || null;
          return flow && canManageFlow(flow) ? (group) => notifyGroup(group, { reminder: false }) : null;
        })()}
        onRemind={(() => {
          const flow = detailsGroup?.primaryFlow || detailsGroup?.flows?.[0] || null;
          return flow && canManageFlow(flow) ? (group) => notifyGroup(group, { reminder: true }) : null;
        })()}
        onActivity={() => {
          const gid = detailsGroup;
          const flow = gid?.primaryFlow || gid?.flows?.[0] || null;
          if (!flow?.id) return;
          setActionsGroup(gid);
          setDetailsOpen(false);
          setAuditOpen(true);
        }}
        onCancel={(group) => {
          setActionsGroup(group);
          setDetailsOpen(false);
          setCancelOpen(true);
        }}
        onComplete={(flow) => {
          const gid = detailsGroup;
          if (!flow?.id || !gid) return;
          setActionsGroup(gid);
          setDetailsOpen(false);
          setCompleteOpen(true);
        }}
        canCancel={(() => {
          const flow = detailsGroup?.primaryFlow || detailsGroup?.flows?.[0] || null;
          const status = String(detailsGroup?.status || flow?.status || "");
          return Boolean(canManageFlow(flow) && status === "InProgress");
        })()}
        canComplete={(() => {
          const flow = detailsGroup?.primaryFlow || detailsGroup?.flows?.[0] || null;
          const kind = normalizeKind(flow?.kind);
          const status = String(detailsGroup?.status || flow?.status || "");
          return (
            kind === "sharedSign" &&
            status !== "Completed" &&
            status !== "Canceled" &&
            Boolean((flow && isAssignedToMe(flow)) || canManageFlow(flow))
          );
        })()}
      />

      <DocSpaceModal open={modalOpen} title={modalTitle} url={modalUrl} onClose={() => setModalOpen(false)} />
    </div>
  );
}
