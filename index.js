/**
 * Host half of the DeepSeek peak-hours bundle.
 *
 * The plugin is deliberately Host-free: the peak/off-peak schedule is a fixed
 * rule, the price table and holiday calendar are static data, and the browser
 * clock already knows the local time. So this module only anchors the Client
 * row and renders nothing itself.
 */
export function apply() {}
