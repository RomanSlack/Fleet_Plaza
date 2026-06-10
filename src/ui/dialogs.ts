import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import type { AppConfig } from "../ipc";
import {
  addProject,
  listSkills,
  removeProject,
  sendTask,
  spawnAgent,
  suggestName,
} from "../ipc";
import { el } from "./format";

function modal(title: string): {
  backdrop: HTMLDivElement;
  box: HTMLDivElement;
  error: HTMLDivElement;
  close: () => void;
} {
  const backdrop = el("div", "modal-backdrop");
  const box = el("div", "modal");
  const error = el("div", "error");
  box.append(el("h2", "", title));
  backdrop.append(box);
  document.getElementById("ui")!.appendChild(backdrop);
  requestAnimationFrame(() => backdrop.classList.add("open"));
  const close = () => {
    backdrop.classList.remove("open");
    setTimeout(() => backdrop.remove(), 180);
  };
  backdrop.addEventListener("pointerdown", (e) => {
    if (e.target === backdrop) close();
  });
  return { backdrop, box, error, close };
}

function labeled(text: string, input: HTMLElement): HTMLLabelElement {
  const label = el("label");
  label.append(text, input);
  return label;
}

export async function openSpawnDialog(
  config: AppConfig,
  preselectZone?: string,
  onSpawned?: (name: string, initialTask: string) => void,
) {
  const { box, error, close } = modal("Spawn Agent");

  const nameInput = el("input");
  nameInput.value = await suggestName();

  const projectSelect = el("select");
  for (const project of config.projects) {
    const opt = el("option", "", project.name);
    opt.value = project.id;
    if (project.id === preselectZone) opt.selected = true;
    projectSelect.append(opt);
  }

  const taskInput = el("textarea");
  taskInput.placeholder = "Optional: first task, sent once the agent is ready…";

  const cancel = el("button", "btn btn-secondary", "Cancel");
  cancel.addEventListener("click", close);
  const spawn = el("button", "btn btn-primary", "Spawn");
  spawn.addEventListener("click", async () => {
    try {
      spawn.toggleAttribute("disabled", true);
      await spawnAgent(projectSelect.value, nameInput.value.trim());
      onSpawned?.(nameInput.value.trim(), taskInput.value.trim());
      close();
    } catch (e) {
      spawn.toggleAttribute("disabled", false);
      error.textContent = String(e);
    }
  });

  const actions = el("div", "modal-actions");
  actions.append(cancel, spawn);
  box.append(
    labeled("Name", nameInput),
    labeled("Project", projectSelect),
    labeled("Initial task", taskInput),
    error,
    actions,
  );
  if (config.projects.length === 0) {
    error.textContent = "No projects registered yet — add one to config.json";
    spawn.toggleAttribute("disabled", true);
  }
}

/** Manage project pads: list/remove existing, add new with a folder picker. */
export function openProjectsDialog(
  config: AppConfig,
  onChanged: (config: AppConfig) => void,
) {
  const { box, error, close } = modal("Projects");

  const list = el("div");
  list.style.cssText = "display:flex;flex-direction:column;gap:6px";
  const renderList = (cfg: AppConfig) => {
    list.textContent = "";
    for (const project of cfg.projects) {
      const row = el("div", "info-row");
      const left = el("span", "k");
      const dot = el("span");
      dot.style.cssText = `display:inline-block;width:10px;height:10px;border-radius:50%;background:${project.color};margin-right:8px`;
      left.append(dot, `${project.name}  —  ${project.path}`);
      const remove = el("button", "btn btn-danger", "Remove");
      remove.style.padding = "2px 10px";
      remove.addEventListener("click", async () => {
        const updated = await removeProject(project.id);
        renderList(updated);
        onChanged(updated);
      });
      row.append(left, remove);
      list.append(row);
    }
    if (cfg.projects.length === 0) {
      list.append(el("div", "k", "No projects yet — add one below."));
    }
  };
  renderList(config);

  const nameInput = el("input");
  nameInput.placeholder = "Project name";
  const pathInput = el("input");
  pathInput.placeholder = "/path/to/repo";
  const browse = el("button", "btn btn-secondary", "Browse…");
  browse.addEventListener("click", async () => {
    const dir = await openFileDialog({ directory: true });
    if (typeof dir === "string") {
      pathInput.value = dir;
      if (!nameInput.value) nameInput.value = dir.split("/").pop() ?? "";
    }
  });
  const colorInput = el("input");
  colorInput.type = "color";
  colorInput.value = "#1d3a55";
  colorInput.style.cssText = "height:36px;padding:2px";

  const pathRow = el("div");
  pathRow.style.cssText = "display:flex;gap:8px";
  pathInput.style.flex = "1";
  pathRow.append(pathInput, browse);

  const add = el("button", "btn btn-primary", "Add project");
  add.addEventListener("click", async () => {
    try {
      error.textContent = "";
      const updated = await addProject(
        pathInput.value.trim(),
        nameInput.value.trim() || (pathInput.value.split("/").pop() ?? "project"),
        colorInput.value,
      );
      nameInput.value = "";
      pathInput.value = "";
      renderList(updated);
      onChanged(updated);
    } catch (e) {
      error.textContent = String(e);
    }
  });

  const done = el("button", "btn btn-secondary", "Done");
  done.addEventListener("click", close);
  const actions = el("div", "modal-actions");
  actions.append(done, add);

  box.append(
    list,
    labeled("Name", nameInput),
    labeled("Folder", pathRow),
    labeled("Pad color", colorInput),
    error,
    actions,
  );
}

export function openConfirm(
  title: string,
  body: string,
  okLabel = "OK",
): Promise<boolean> {
  return new Promise((resolve) => {
    const { box, close } = modal(title);
    const text = el("div", "", body);
    text.style.cssText = "font-size:13px;color:var(--text-2);line-height:1.5";
    const cancel = el("button", "btn btn-secondary", "Cancel");
    const ok = el("button", "btn btn-primary", okLabel);
    cancel.addEventListener("click", () => {
      close();
      resolve(false);
    });
    ok.addEventListener("click", () => {
      close();
      resolve(true);
    });
    const actions = el("div", "modal-actions");
    actions.append(cancel, ok);
    box.append(text, actions);
  });
}

export async function openTaskDialog(
  agentName: string,
  projectRef?: { name: string; path: string },
) {
  const { box, error, close } = modal(`Assign task → ${agentName}`);

  let refChip: HTMLElement | null = null;
  if (projectRef) {
    refChip = el("div", "pill", `📁 Context: ${projectRef.name} — ${projectRef.path}`);
    refChip.style.alignSelf = "flex-start";
  }

  const skillSelect = el("select");
  const none = el("option", "", "No skill template");
  none.value = "";
  skillSelect.append(none);
  listSkills().then((skills) => {
    for (const skill of skills) {
      const opt = el("option", "", `/${skill.name}`);
      opt.value = skill.name;
      opt.title = skill.description;
      skillSelect.append(opt);
    }
  });

  const taskInput = el("textarea");
  taskInput.placeholder = "Describe the task…";

  const cancel = el("button", "btn btn-secondary", "Cancel");
  cancel.addEventListener("click", close);
  const send = el("button", "btn btn-primary", "Send");
  send.addEventListener("click", async () => {
    const body = taskInput.value.trim();
    if (!body && !skillSelect.value) return;
    let text = skillSelect.value
      ? `Use the ${skillSelect.value} skill. ${body}`
      : body;
    if (projectRef) {
      text = `For this task, use the project at ${projectRef.path} (${projectRef.name}) as your working context — read what you need from there.\n\n${text}`;
    }
    try {
      send.textContent = "Sending…";
      send.toggleAttribute("disabled", true);
      await sendTask(agentName, text);
      close();
    } catch (e) {
      send.textContent = "Send";
      send.toggleAttribute("disabled", false);
      error.textContent = String(e);
    }
  });

  const actions = el("div", "modal-actions");
  actions.append(cancel, send);
  if (refChip) box.append(refChip);
  box.append(
    labeled("Skill template", skillSelect),
    labeled("Task", taskInput),
    error,
    actions,
  );
  taskInput.focus();
}
