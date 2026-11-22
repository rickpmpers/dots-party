export const BOARD_SIZE = 6; // 6x6 dots, 25 boxes
export const MAX_PLAYERS = 10;

export function newBoard(size = BOARD_SIZE) {
  return { size, horizontal: Array.from({ length: size }, () => Array(size - 1).fill(null)), vertical: Array.from({ length: size - 1 }, () => Array(size).fill(null)), boxes: Array.from({ length: size - 1 }, () => Array(size - 1).fill(null)) };
}

export function playLine(board, orientation, row, col, playerId) {
  const { size } = board;
  if (!['h', 'v'].includes(orientation) || !Number.isInteger(row) || !Number.isInteger(col)) return { error: 'Invalid line.' };
  const horizontal = orientation === 'h';
  if (row < 0 || col < 0 || row >= (horizontal ? size : size - 1) || col >= (horizontal ? size - 1 : size)) return { error: 'Line is out of bounds.' };
  const target = horizontal ? board.horizontal : board.vertical;
  if (target[row][col] !== null) return { error: 'That line is already drawn.' };
  target[row][col] = playerId;
  const candidates = horizontal ? [[row - 1, col], [row, col]] : [[row, col - 1], [row, col]];
  const claimed = [];
  for (const [r,c] of candidates) {
    if (r < 0 || c < 0 || r >= size - 1 || c >= size - 1 || board.boxes[r][c] !== null) continue;
    if (board.horizontal[r][c] !== null && board.horizontal[r + 1][c] !== null && board.vertical[r][c] !== null && board.vertical[r][c + 1] !== null) {
      board.boxes[r][c] = playerId;
      claimed.push([r,c]);
    }
  }
  return { claimed, complete: board.boxes.every(row => row.every(cell => cell !== null)) };
}

export function publicState(room) {
  return {
    code: room.code, status: room.status, hostId: room.hostId, maxPlayers: MAX_PLAYERS,
    players: room.players.map(({ id, name, color, connected, score }) => ({ id, name, color, connected, score })),
    board: room.board, turnId: room.turnId, winnerIds: room.winnerIds || [],
    message: room.message || '',
  };
}
