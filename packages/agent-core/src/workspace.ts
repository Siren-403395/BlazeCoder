/**
 * InMemoryWorkspace — the default Workspace port impl. Holds the project file
 * graph during a run; the runtime hydrates it from the persisted session and
 * snapshots it back. Pure data, fully unit-testable.
 */

import type { GeneratedProject, ProjectFile } from "@coding-agent/shared";
import type { Workspace } from "./ports";

export class InMemoryWorkspace implements Workspace {
  private readonly files = new Map<string, ProjectFile>();
  private projectName: string;
  private summary: string;
  private features: string[];
  private runInstructions: string;

  constructor(project: GeneratedProject) {
    this.projectName = project.projectName;
    this.summary = project.summary;
    this.features = [...project.features];
    this.runInstructions = project.runInstructions;
    for (const file of project.files) this.files.set(file.path, { ...file });
  }

  list(): ProjectFile[] {
    return [...this.files.values()];
  }

  read(path: string): ProjectFile | undefined {
    const file = this.files.get(path);
    return file ? { ...file } : undefined;
  }

  write(file: ProjectFile): void {
    this.files.set(file.path, { ...file });
  }

  delete(path: string): boolean {
    return this.files.delete(path);
  }

  exists(path: string): boolean {
    return this.files.has(path);
  }

  snapshot(): GeneratedProject {
    return {
      projectName: this.projectName,
      summary: this.summary,
      features: [...this.features],
      runInstructions: this.runInstructions,
      files: this.list().sort((a, b) => a.path.localeCompare(b.path)),
    };
  }
}
