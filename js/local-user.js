export function getLocalUserId() {
  try {
    let id = localStorage.getItem('syllastudy_local_user_id');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('syllastudy_local_user_id', id);
    }
    return id;
  } catch {
    return 'anonymous';
  }
}

