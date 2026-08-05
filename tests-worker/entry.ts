export { AccountCredits, AnonymousQuota } from '../src/features/billing/durable-objects';

export default { fetch: () => new Response('billing test worker') } satisfies ExportedHandler<Env>;
