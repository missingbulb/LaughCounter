// Whether a member's scheduler is dormant, published for the packs that must ask it
// from outside: the dashboard (which hides work it knows cannot move) and the fleet
// sweeps (which must not report a stopped scheduler as unhealthy). Re-exported rather
// than reimplemented so a consumer and the queue can never disagree about what the
// declaration means.
export { isDormant, dormancyErrors, TASKS_PACK_ID } from '../dormancy.mjs';
