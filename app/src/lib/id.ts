/** Random UUID made on the device, so records can be saved offline and synced later without duplicates. */
export const newId = () => (crypto as Crypto & { randomUUID?: () => string }).randomUUID?.()
  ?? 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
