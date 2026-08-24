// Which of a repo's declared tasks a scheduler run would instantiate an item for at a
// given instant — the plan a forced sweep has to predict. Its own module rather than a
// line in work-items.mjs: the scheduler run reaches Node built-ins, and the dashboard
// loads work-items.mjs unbundled in a browser, where only relative specifiers resolve.
export { planWake } from '../queue/scheduler-run.mjs';
