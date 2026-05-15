const levels = {
  info:  '\x1b[36m[INFO]\x1b[0m ',
  warn:  '\x1b[33m[WARN]\x1b[0m ',
  error: '\x1b[31m[ERROR]\x1b[0m',
};
function timestamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}
const logger = {
  info:  (msg) => console.log(`${timestamp()}  ${levels.info}  ${msg}`),
  warn:  (msg) => console.warn(`${timestamp()}  ${levels.warn}  ${msg}`),
  error: (msg) => console.error(`${timestamp()}  ${levels.error} ${msg}`),
};
module.exports = logger;
