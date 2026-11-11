const pad = (n: number) => String(n).padStart(2, "0");

/** Nome da subpasta de uma execução, em hora local: AAAA-MM-DD_HHMMSS. */
export function runFolderName(date: Date): string {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `${day}_${time}`;
}
