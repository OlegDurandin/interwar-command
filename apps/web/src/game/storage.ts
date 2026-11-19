type Slot = 'auto' | 'manual';
let connection: Promise<IDBDatabase> | undefined;
let tail: Promise<void> = Promise.resolve();
// Compare the persisted value inside the same write transaction. An older tab
// must reload before it can overwrite the game committed by a newer tab.
const known = new Map<Slot,string | undefined>();

function database() {
  if (!connection) {
    connection = new Promise<IDBDatabase>((resolve,reject) => {
      const request=indexedDB.open('interwar-command',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('games');
      request.onsuccess=()=>{
        const db=request.result;
        db.onversionchange=()=>{db.close();connection=undefined;};
        resolve(db);
      };
      request.onerror=()=>reject(request.error);
    }).catch((error:unknown)=>{connection=undefined;throw error;});
  }
  return connection;
}

export async function readSlot(slot:Slot):Promise<string|undefined> {
  await tail;
  const db=await database();
  const value=await new Promise<string|undefined>((resolve,reject)=>{
    const tx=db.transaction('games','readonly');
    const request=tx.objectStore('games').get(slot);
    tx.oncomplete=()=>resolve(request.result as string|undefined);
    tx.onabort=()=>reject(tx.error);
  });
  known.set(slot,value);
  return value;
}

async function commit(slot:Slot, data:string) {
  const db=await database();
  await new Promise<void>((resolve,reject)=>{
    const tx=db.transaction('games','readwrite');
    const store=tx.objectStore('games');
    const request=store.get(slot);
    let conflict=false;
    request.onsuccess=()=>{
      if (known.has(slot) && known.get(slot)!==request.result) {conflict=true;tx.abort();}
      else store.put(data,slot);
    };
    tx.oncomplete=()=>{known.set(slot,data);resolve();};
    tx.onabort=()=>reject(conflict ? new Error('Партия изменена в другой вкладке. Обновите страницу.') : tx.error ?? new Error('Запись прервана'));
  });
}

export function writeSlot(slot:Slot, data:string) {
  const pending=tail.then(()=>commit(slot,data));
  tail=pending.catch(()=>{});
  return pending;
}
