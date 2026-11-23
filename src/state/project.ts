import { STARTER_PROJECT, STARTER_RECIPES } from '../data/starter-recipes';
import type { AppState, Project } from '../core/types';

/** Short random id with a type prefix, e.g. `p_k3j9fa2`. */
export function uid(prefix: string): string {
  return prefix + Math.random().toString(36).slice(2, 9);
}

export function deepClone<T>(value: T): T {
  return structuredClone(value);
}

const PROJECT_DEFAULTS: Omit<Project, 'id'> = {
  name: 'New plan',
  targets: [],
  choices: {},
  nodes: {},
  defaultTier: 1,
  defaultCoil: 0,
  gridTier: 2,
  autoExpand: true,
  gen: { preset: 0, eut: 32 },
};

/**
 * A plan with the defaults filled in. Anything copied in from `base` is cloned, and the result
 * always gets a fresh id — this is also how duplicating and importing a plan work, and two plans
 * must never share one.
 */
export function newProject(base?: Partial<Project>): Project {
  return {
    ...deepClone(PROJECT_DEFAULTS),
    ...(base ? deepClone(base) : {}),
    id: uid('p_'),
  };
}

/** What a fresh install starts with: the example recipes and a small plan using them. */
export function defaultState(): AppState {
  const project = newProject(STARTER_PROJECT);
  return {
    library: deepClone(STARTER_RECIPES) as AppState['library'],
    projects: [project],
    activeId: project.id,
    unit: 's',
  };
}
