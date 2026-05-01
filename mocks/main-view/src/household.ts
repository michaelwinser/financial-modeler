// Helpers for the Household / Actor model introduced in Phase 3.5.
//
// The household is a singleton container holding 1–2 actors plus
// scenario-level fields. Code that needs a specific actor's age, or to
// resolve which actor "owns" an account, goes through these helpers so
// the back-compat default (everything → primary actor) lives in one
// place rather than scattered across engine + components.

import type { AccountNode, Actor, Household } from './types';

// The primary actor — the lead person, present even in single-actor
// households. Falls back to actors[0] if primary_actor_id is somehow
// missing (defensive against migrated data).
export function primaryActor(h: Household): Actor {
  return h.actors.find((a) => a.id === h.primary_actor_id) ?? h.actors[0];
}

// All actors who are currently alive. The death event flips alive=false
// from a given age onward; survivor-stage logic (filing flips, RMD-
// schedule collapse) uses this list.
export function aliveActors(h: Household): Actor[] {
  return h.actors.filter((a) => a.alive);
}

// Look up an actor by id; returns the primary as fallback.
export function actorById(h: Household, id: string | undefined): Actor {
  if (!id) return primaryActor(h);
  return h.actors.find((a) => a.id === id) ?? primaryActor(h);
}

// Resolve who owns an account. Default: [primary]. Returns the first
// owner-actor — used when one ownership slot is sufficient (streams,
// RMDs). For joint-asset analysis use account.owners directly.
export function ownerActor(h: Household, node: AccountNode): Actor {
  const ids = node.owners ?? [];
  if (ids.length === 0) return primaryActor(h);
  return actorById(h, ids[0]);
}

// All actors who own a given account (resolved with the primary
// fallback). Length>1 means joint ownership.
export function ownersOf(h: Household, node: AccountNode): Actor[] {
  const ids = node.owners ?? [h.primary_actor_id];
  return ids
    .map((id) => h.actors.find((a) => a.id === id))
    .filter((a): a is Actor => a !== undefined);
}
