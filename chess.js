/* ==========================================================
   CHESS MASTER AI — Complete Chess Engine, AI & UI
   ========================================================== */

// ==================== PIECE UNICODE MAP ====================
const PIECE_CHAR = {
  wK: '♔', wQ: '♕', wR: '♖', wB: '♗', wN: '♘', wP: '♙',
  bK: '♚', bQ: '♛', bR: '♜', bB: '♝', bN: '♞', bP: '♟'
};
const PIECE_VAL = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 20000 };
const FILES = 'abcdefgh';
const RANKS = '87654321';

// ==================== SOUND ENGINE ====================
class SoundEngine {
  constructor() { this.ctx = null; this.enabled = true; }

  _ctx() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  play(type) {
    if (!this.enabled) return;
    try {
      const ctx = this._ctx();
      const t = ctx.currentTime;
      switch (type) {
        case 'move': this._wood(ctx, t, 800, 0.06, 0.25); break;
        case 'capture': this._wood(ctx, t, 400, 0.1, 0.4); this._noise(ctx, t, 0.08, 0.15); break;
        case 'check': this._tone(ctx, t, 520, 0.12, 'triangle', 0.3); this._tone(ctx, t + 0.06, 660, 0.1, 'triangle', 0.25); break;
        case 'castle': this._wood(ctx, t, 700, 0.06, 0.2); this._wood(ctx, t + 0.12, 900, 0.06, 0.2); break;
        case 'gameover':
          this._tone(ctx, t,       330, 0.3, 'triangle', 0.2);
          this._tone(ctx, t + 0.15, 262, 0.3, 'triangle', 0.2);
          this._tone(ctx, t + 0.30, 220, 0.5, 'triangle', 0.2);
          break;
        case 'illegal': this._tone(ctx, t, 200, 0.15, 'sawtooth', 0.1); break;
      }
    } catch (e) { /* Audio not available */ }
  }

  _tone(ctx, t, freq, dur, type, vol) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g); g.connect(ctx.destination);
    osc.start(t); osc.stop(t + dur);
  }

  _wood(ctx, t, freq, dur, vol) {
    // Simulates a wood-tap: short filtered noise burst + low tone
    const bufSize = ctx.sampleRate * dur;
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufSize * 0.15));
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(bp); bp.connect(g); g.connect(ctx.destination);
    src.start(t); src.stop(t + dur);
  }

  _noise(ctx, t, dur, vol) {
    const bufSize = ctx.sampleRate * dur;
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufSize * 0.2));
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 2000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(lp); lp.connect(g); g.connect(ctx.destination);
    src.start(t); src.stop(t + dur);
  }
}

// ==================== CHESS ENGINE ====================
class ChessGame {
  constructor() { this.reset(); }

  reset() {
    this.board = this._initBoard();
    this.turn = 'w';
    this.castling = { K: true, Q: true, k: true, q: true };
    this.enPassant = null;
    this.halfMoves = 0;
    this.fullMoves = 1;
    this.history = [];
    this.posHashes = {};
    this.gameOver = false;
    this.result = null;
    this.resultReason = '';
    this._recHash();
  }

  _initBoard() {
    const b = Array.from({ length: 8 }, () => Array(8).fill(null));
    const back = ['R','N','B','Q','K','B','N','R'];
    for (let c = 0; c < 8; c++) {
      b[0][c] = { t: back[c], c: 'b' };
      b[1][c] = { t: 'P', c: 'b' };
      b[6][c] = { t: 'P', c: 'w' };
      b[7][c] = { t: back[c], c: 'w' };
    }
    return b;
  }

  _ok(r, c) { return r >= 0 && r <= 7 && c >= 0 && c <= 7; }
  at(r, c) { return this._ok(r, c) ? this.board[r][c] : null; }

  findKing(color) {
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++) {
        const p = this.board[r][c];
        if (p && p.t === 'K' && p.c === color) return [r, c];
      }
    return null;
  }

  isAttacked(r, c, by) {
    const pd = by === 'w' ? 1 : -1;
    for (const dc of [-1, 1]) {
      const pr = r + pd, pc = c + dc;
      if (this._ok(pr, pc)) { const p = this.board[pr][pc]; if (p && p.c === by && p.t === 'P') return true; }
    }
    for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
      const nr = r+dr, nc = c+dc;
      if (this._ok(nr, nc)) { const p = this.board[nr][nc]; if (p && p.c === by && p.t === 'N') return true; }
    }
    for (const [dr, dc] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) {
      const nr = r+dr, nc = c+dc;
      if (this._ok(nr, nc)) { const p = this.board[nr][nc]; if (p && p.c === by && p.t === 'K') return true; }
    }
    for (const [dr, dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
      for (let i = 1; i < 8; i++) {
        const nr = r+dr*i, nc = c+dc*i;
        if (!this._ok(nr, nc)) break;
        const p = this.board[nr][nc];
        if (p) { if (p.c === by && (p.t === 'B' || p.t === 'Q')) return true; break; }
      }
    }
    for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      for (let i = 1; i < 8; i++) {
        const nr = r+dr*i, nc = c+dc*i;
        if (!this._ok(nr, nc)) break;
        const p = this.board[nr][nc];
        if (p) { if (p.c === by && (p.t === 'R' || p.t === 'Q')) return true; break; }
      }
    }
    return false;
  }

  inCheck(color) {
    const k = this.findKing(color);
    return k ? this.isAttacked(k[0], k[1], color === 'w' ? 'b' : 'w') : false;
  }

  _pieceMoves(r, c) {
    const piece = this.board[r][c];
    if (!piece) return [];
    const { t, c: color } = piece;
    const enemy = color === 'w' ? 'b' : 'w';
    const moves = [];
    const push = (tr, tc, extra) => moves.push({ fr: r, fc: c, tr, tc, ...extra });

    if (t === 'P') {
      const dir = color === 'w' ? -1 : 1;
      const promoRow = color === 'w' ? 0 : 7;
      const startRow = color === 'w' ? 6 : 1;
      if (this._ok(r+dir, c) && !this.board[r+dir][c]) {
        if (r+dir === promoRow) { for (const pr of ['Q','R','B','N']) push(r+dir, c, { promo: pr }); }
        else {
          push(r+dir, c);
          if (r === startRow && !this.board[r+2*dir][c]) push(r+2*dir, c);
        }
      }
      for (const dc of [-1, 1]) {
        const nr = r+dir, nc = c+dc;
        if (!this._ok(nr, nc)) continue;
        const target = this.board[nr][nc];
        if (target && target.c === enemy) {
          if (nr === promoRow) { for (const pr of ['Q','R','B','N']) push(nr, nc, { promo: pr }); }
          else push(nr, nc);
        }
        if (this.enPassant && nr === this.enPassant[0] && nc === this.enPassant[1])
          push(nr, nc, { ep: true });
      }
    } else if (t === 'N') {
      for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
        const nr = r+dr, nc = c+dc;
        if (this._ok(nr, nc) && (!this.board[nr][nc] || this.board[nr][nc].c === enemy)) push(nr, nc);
      }
    } else if (t === 'K') {
      for (const [dr, dc] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) {
        const nr = r+dr, nc = c+dc;
        if (this._ok(nr, nc) && (!this.board[nr][nc] || this.board[nr][nc].c === enemy)) push(nr, nc);
      }
      const row = color === 'w' ? 7 : 0;
      const ck = color === 'w' ? 'K' : 'k', cq = color === 'w' ? 'Q' : 'q';
      if (this.castling[ck] && r === row && c === 4 &&
          !this.board[row][5] && !this.board[row][6] &&
          this.board[row][7] && this.board[row][7].t === 'R' && this.board[row][7].c === color &&
          !this.isAttacked(row, 4, enemy) && !this.isAttacked(row, 5, enemy) && !this.isAttacked(row, 6, enemy))
        push(row, 6, { castle: 'K' });
      if (this.castling[cq] && r === row && c === 4 &&
          !this.board[row][3] && !this.board[row][2] && !this.board[row][1] &&
          this.board[row][0] && this.board[row][0].t === 'R' && this.board[row][0].c === color &&
          !this.isAttacked(row, 4, enemy) && !this.isAttacked(row, 3, enemy) && !this.isAttacked(row, 2, enemy))
        push(row, 2, { castle: 'Q' });
    } else {
      const dirs = t === 'B' ? [[-1,-1],[-1,1],[1,-1],[1,1]] :
                   t === 'R' ? [[-1,0],[1,0],[0,-1],[0,1]] :
                   [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
      for (const [dr, dc] of dirs) {
        for (let i = 1; i < 8; i++) {
          const nr = r+dr*i, nc = c+dc*i;
          if (!this._ok(nr, nc)) break;
          const tgt = this.board[nr][nc];
          if (!tgt) push(nr, nc);
          else { if (tgt.c === enemy) push(nr, nc); break; }
        }
      }
    }
    return moves;
  }

  _isLegal(move) {
    const piece = this.board[move.fr][move.fc];
    const color = piece.c;
    this.makeMove(move);
    const legal = !this.inCheck(color);
    this.undoMove();
    return legal;
  }

  getLegalMoves(r, c) {
    const p = this.board[r][c];
    if (!p || p.c !== this.turn) return [];
    return this._pieceMoves(r, c).filter(m => this._isLegal(m));
  }

  allLegalMoves() {
    const moves = [];
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++) {
        const p = this.board[r][c];
        if (p && p.c === this.turn)
          for (const m of this._pieceMoves(r, c))
            if (this._isLegal(m)) moves.push(m);
      }
    return moves;
  }

  makeMove(move) {
    const p = this.board[move.fr][move.fc];
    const cap = this.board[move.tr][move.tc];
    const undo = {
      move, cap,
      castling: { ...this.castling },
      enPassant: this.enPassant,
      halfMoves: this.halfMoves
    };
    this.board[move.tr][move.tc] = move.promo ? { t: move.promo, c: p.c } : p;
    this.board[move.fr][move.fc] = null;
    if (move.ep) {
      undo.epCapPiece = this.board[move.fr][move.tc];
      this.board[move.fr][move.tc] = null;
    }
    if (move.castle) {
      const row = move.fr;
      if (move.castle === 'K') { this.board[row][5] = this.board[row][7]; this.board[row][7] = null; }
      else { this.board[row][3] = this.board[row][0]; this.board[row][0] = null; }
    }
    this.enPassant = null;
    if (p.t === 'P' && Math.abs(move.tr - move.fr) === 2)
      this.enPassant = [(move.fr + move.tr) / 2, move.fc];
    if (p.t === 'K') {
      if (p.c === 'w') { this.castling.K = false; this.castling.Q = false; }
      else { this.castling.k = false; this.castling.q = false; }
    }
    if (p.t === 'R') {
      if (move.fr === 7 && move.fc === 7) this.castling.K = false;
      if (move.fr === 7 && move.fc === 0) this.castling.Q = false;
      if (move.fr === 0 && move.fc === 7) this.castling.k = false;
      if (move.fr === 0 && move.fc === 0) this.castling.q = false;
    }
    if (move.tr === 7 && move.tc === 7) this.castling.K = false;
    if (move.tr === 7 && move.tc === 0) this.castling.Q = false;
    if (move.tr === 0 && move.tc === 7) this.castling.k = false;
    if (move.tr === 0 && move.tc === 0) this.castling.q = false;
    this.halfMoves = (p.t === 'P' || cap || move.ep) ? 0 : this.halfMoves + 1;
    if (this.turn === 'b') this.fullMoves++;
    this.turn = this.turn === 'w' ? 'b' : 'w';
    this.history.push(undo);
    return undo;
  }

  undoMove() {
    if (!this.history.length) return null;
    const u = this.history.pop();
    const m = u.move;
    this.turn = this.turn === 'w' ? 'b' : 'w';
    if (this.turn === 'b') this.fullMoves--;
    const piece = this.board[m.tr][m.tc];
    this.board[m.fr][m.fc] = m.promo ? { t: 'P', c: piece.c } : piece;
    this.board[m.tr][m.tc] = u.cap;
    if (m.ep) this.board[m.fr][m.tc] = u.epCapPiece;
    if (m.castle) {
      const row = m.fr;
      if (m.castle === 'K') { this.board[row][7] = this.board[row][5]; this.board[row][5] = null; }
      else { this.board[row][0] = this.board[row][3]; this.board[row][3] = null; }
    }
    this.castling = u.castling;
    this.enPassant = u.enPassant;
    this.halfMoves = u.halfMoves;
    return u;
  }

  moveNotation(move) {
    if (move.castle === 'K') return 'O-O';
    if (move.castle === 'Q') return 'O-O-O';
    const piece = this.board[move.fr][move.fc];
    let n = '';
    if (piece.t !== 'P') {
      n += piece.t;
      const others = this.allLegalMoves().filter(m =>
        this.board[m.fr][m.fc].t === piece.t &&
        m.tr === move.tr && m.tc === move.tc &&
        (m.fr !== move.fr || m.fc !== move.fc)
      );
      if (others.length) {
        const sameFile = others.some(m => m.fc === move.fc);
        const sameRank = others.some(m => m.fr === move.fr);
        if (!sameFile) n += FILES[move.fc];
        else if (!sameRank) n += RANKS[move.fr];
        else n += FILES[move.fc] + RANKS[move.fr];
      }
    }
    const isCapture = this.board[move.tr][move.tc] || move.ep;
    if (isCapture) {
      if (piece.t === 'P') n += FILES[move.fc];
      n += 'x';
    }
    n += FILES[move.tc] + RANKS[move.tr];
    if (move.promo) n += '=' + move.promo;
    return n;
  }

  addCheckSymbol(notation) {
    const moves = this.allLegalMoves();
    if (this.inCheck(this.turn)) return notation + (moves.length === 0 ? '#' : '+');
    return notation;
  }

  _posHash() {
    let h = '';
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++) { const p = this.board[r][c]; h += p ? p.c + p.t : '..'; }
    h += this.turn;
    h += (this.castling.K?'K':'')+(this.castling.Q?'Q':'')+(this.castling.k?'k':'')+(this.castling.q?'q':'');
    if (this.enPassant) h += this.enPassant[0]+''+this.enPassant[1];
    return h;
  }

  _recHash() {
    const h = this._posHash();
    this.posHashes[h] = (this.posHashes[h] || 0) + 1;
  }

  checkGameEnd() {
    const moves = this.allLegalMoves();
    if (moves.length === 0) {
      this.gameOver = true;
      if (this.inCheck(this.turn)) {
        this.result = this.turn === 'w' ? '0-1' : '1-0';
        this.resultReason = 'Checkmate';
      } else { this.result = '½-½'; this.resultReason = 'Stalemate'; }
      return true;
    }
    if (this.halfMoves >= 100) { this.gameOver = true; this.result = '½-½'; this.resultReason = '50-move rule'; return true; }
    const h = this._posHash();
    if ((this.posHashes[h] || 0) >= 3) { this.gameOver = true; this.result = '½-½'; this.resultReason = 'Threefold repetition'; return true; }
    const pieces = { w: [], b: [] };
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++) { const p = this.board[r][c]; if (p && p.t !== 'K') pieces[p.c].push(p.t); }
    const wl = pieces.w, bl = pieces.b;
    if (wl.length === 0 && bl.length === 0) { this.gameOver = true; this.result = '½-½'; this.resultReason = 'Insufficient material'; return true; }
    if (wl.length === 0 && bl.length === 1 && (bl[0]==='B'||bl[0]==='N')) { this.gameOver = true; this.result = '½-½'; this.resultReason = 'Insufficient material'; return true; }
    if (bl.length === 0 && wl.length === 1 && (wl[0]==='B'||wl[0]==='N')) { this.gameOver = true; this.result = '½-½'; this.resultReason = 'Insufficient material'; return true; }
    return false;
  }
}

// ==================== AI ENGINE ====================

// --- Piece-Square Tables (Middlegame) ---
const PST = {
  P: [[0,0,0,0,0,0,0,0],[50,50,50,50,50,50,50,50],[10,10,20,30,30,20,10,10],[5,5,10,25,25,10,5,5],[0,0,0,20,20,0,0,0],[5,-5,-10,0,0,-10,-5,5],[5,10,10,-20,-20,10,10,5],[0,0,0,0,0,0,0,0]],
  N: [[-50,-40,-30,-30,-30,-30,-40,-50],[-40,-20,0,0,0,0,-20,-40],[-30,0,10,15,15,10,0,-30],[-30,5,15,20,20,15,5,-30],[-30,0,15,20,20,15,0,-30],[-30,5,10,15,15,10,5,-30],[-40,-20,0,5,5,0,-20,-40],[-50,-40,-30,-30,-30,-30,-40,-50]],
  B: [[-20,-10,-10,-10,-10,-10,-10,-20],[-10,0,0,0,0,0,0,-10],[-10,0,10,10,10,10,0,-10],[-10,5,5,10,10,5,5,-10],[-10,0,5,10,10,5,0,-10],[-10,10,5,10,10,5,10,-10],[-10,5,0,0,0,0,5,-10],[-20,-10,-10,-10,-10,-10,-10,-20]],
  R: [[0,0,0,0,0,0,0,0],[5,10,10,10,10,10,10,5],[-5,0,0,0,0,0,0,-5],[-5,0,0,0,0,0,0,-5],[-5,0,0,0,0,0,0,-5],[-5,0,0,0,0,0,0,-5],[-5,0,0,0,0,0,0,-5],[0,0,0,5,5,0,0,0]],
  Q: [[-20,-10,-10,-5,-5,-10,-10,-20],[-10,0,0,0,0,0,0,-10],[-10,0,5,5,5,5,0,-10],[-5,0,5,5,5,5,0,-5],[0,0,5,5,5,5,0,-5],[-10,5,5,5,5,5,0,-10],[-10,0,5,0,0,0,0,-10],[-20,-10,-10,-5,-5,-10,-10,-20]],
  K: [[-30,-40,-40,-50,-50,-40,-40,-30],[-30,-40,-40,-50,-50,-40,-40,-30],[-30,-40,-40,-50,-50,-40,-40,-30],[-30,-40,-40,-50,-50,-40,-40,-30],[-20,-30,-30,-40,-40,-30,-30,-20],[-10,-20,-20,-20,-20,-20,-20,-10],[20,20,0,0,0,0,20,20],[20,30,10,0,0,10,30,20]]
};

// --- Endgame King PST (centralize the king) ---
const PST_KING_EG = [
  [-50,-30,-30,-30,-30,-30,-30,-50],
  [-30,-15,  0,  0,  0,  0,-15,-30],
  [-30,  0, 15, 20, 20, 15,  0,-30],
  [-30,  0, 20, 25, 25, 20,  0,-30],
  [-30,  0, 20, 25, 25, 20,  0,-30],
  [-30,  0, 15, 20, 20, 15,  0,-30],
  [-30,-15,  0,  0,  0,  0,-15,-30],
  [-50,-30,-30,-30,-30,-30,-30,-50]
];

// Passed pawn bonus by row (white pawn perspective: row 1 = near promo, row 6 = just advanced)
const PASSED_PAWN_BONUS = [0, 120, 80, 50, 30, 15, 10, 0];

// --- Opening Book (expanded) ---
const OPENING_BOOK = {
  "": ["e4", "d4", "Nf3", "c4"],
  "e4": ["e5", "c5", "e6", "c6", "d5"],
  "e4 e5": ["Nf3", "Nc3", "Bc4", "f4"],
  "e4 e5 Nf3": ["Nc6", "Nf6", "d6"],
  "e4 e5 Nf3 Nc6": ["Bb5", "Bc4", "d4"],
  "e4 e5 Nf3 Nc6 Bb5": ["a6", "Nf6", "d6"],
  "e4 e5 Nf3 Nc6 Bc4": ["Nf6", "Bc5"],
  "e4 e5 Nf3 Nf6": ["Nxe5", "Nc3", "d4"],
  "e4 c5": ["Nf3", "Nc3", "c3"],
  "e4 c5 Nf3": ["d6", "e6", "Nc6"],
  "e4 c5 Nf3 d6": ["d4", "Bb5"],
  "e4 c5 Nf3 Nc6": ["d4", "Bb5"],
  "e4 c6": ["d4", "Nf3", "Nc3"],
  "e4 c6 d4": ["d5"],
  "e4 c6 d4 d5": ["e5", "Nc3", "exd5"],
  "e4 e6": ["d4", "Nf3"],
  "e4 e6 d4": ["d5"],
  "e4 e6 d4 d5": ["Nc3", "Nd2", "e5"],
  "e4 d5": ["exd5", "e5", "Nc3"],
  "d4": ["d5", "Nf6", "e6", "f5"],
  "d4 d5": ["c4", "Nf3", "Bf4"],
  "d4 d5 c4": ["e6", "c6", "dxc4"],
  "d4 d5 c4 e6": ["Nc3", "Nf3"],
  "d4 d5 Nf3": ["Nf6", "e6", "c6"],
  "d4 Nf6": ["c4", "Nf3", "Bg5"],
  "d4 Nf6 c4": ["e6", "g6", "c5"],
  "d4 Nf6 c4 e6": ["Nc3", "Nf3", "g3"],
  "d4 Nf6 c4 g6": ["Nc3", "Nf3"],
  "d4 f5": ["c4", "Nf3", "g3"],
  "Nf3": ["d5", "Nf6", "c5"],
  "Nf3 Nf6": ["c4", "d4", "g3"],
  "c4": ["e5", "Nf6", "c5"],
  "c4 e5": ["Nc3", "g3"]
};

class ChessAI {
  constructor() {
    this.tt = {};
    this.ttWrites = 0;
    this.maxTTEntries = 250000;
    this.nodes = 0;
  }

  clearTT() {
    this.tt = {};
    this.ttWrites = 0;
  }

  // Game phase factor: 1.0 = full middlegame, 0.0 = pure endgame
  _phase(game) {
    let mat = 0;
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++) {
        const p = game.board[r][c];
        if (p && p.t !== 'K' && p.t !== 'P') mat += PIECE_VAL[p.t];
      }
    return Math.min(1, mat / 6200);
  }

  // King pawn shield score
  _pawnShield(game, kr, kc, color) {
    let shield = 0;
    const dir = color === 'w' ? -1 : 1;
    for (const dc of [-1, 0, 1]) {
      const fc = kc + dc;
      if (fc < 0 || fc > 7) continue;
      for (let i = 1; i <= 2; i++) {
        const fr = kr + dir * i;
        if (fr < 0 || fr > 7) continue;
        const p = game.board[fr][fc];
        if (p && p.t === 'P' && p.c === color) {
          shield += (i === 1) ? 12 : 5;
          break;
        }
      }
    }
    return shield;
  }

  // Enhanced evaluation function
  evaluate(game, level) {
    let score = 0;
    const advanced = level >= 3;
    const phase = advanced ? this._phase(game) : 1;

    // Tracking arrays
    const wPawnCols = [0,0,0,0,0,0,0,0];
    const bPawnCols = [0,0,0,0,0,0,0,0];
    const wPawns = [], bPawns = [];
    let wBishops = 0, bBishops = 0;
    const wRookCols = [], bRookCols = [];

    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++) {
        const p = game.board[r][c];
        if (!p) continue;
        const sign = p.c === 'w' ? 1 : -1;

        // Material
        score += sign * PIECE_VAL[p.t];

        // Piece-square tables
        if (advanced) {
          if (p.t === 'K') {
            const mgVal = PST.K[p.c === 'w' ? r : 7 - r][c];
            const egVal = PST_KING_EG[p.c === 'w' ? r : 7 - r][c];
            score += sign * Math.round(mgVal * phase + egVal * (1 - phase));
          } else {
            score += sign * PST[p.t][p.c === 'w' ? r : 7 - r][c];
          }
        }

        // Track pieces
        if (advanced) {
          if (p.t === 'P') {
            if (p.c === 'w') { wPawnCols[c]++; wPawns.push({ r, c }); }
            else { bPawnCols[c]++; bPawns.push({ r, c }); }
          }
          if (p.t === 'B') { if (p.c === 'w') wBishops++; else bBishops++; }
          if (p.t === 'R') { if (p.c === 'w') wRookCols.push(c); else bRookCols.push(c); }
        }
      }

    if (!advanced) return score;

    // === Bishop pair ===
    if (wBishops >= 2) score += 35;
    if (bBishops >= 2) score -= 35;

    // === Pawn structure ===
    for (let f = 0; f < 8; f++) {
      // Doubled pawns
      if (wPawnCols[f] > 1) score -= 15 * (wPawnCols[f] - 1);
      if (bPawnCols[f] > 1) score += 15 * (bPawnCols[f] - 1);
      // Isolated pawns
      if (wPawnCols[f] > 0) {
        const adj = (f > 0 ? wPawnCols[f - 1] : 0) + (f < 7 ? wPawnCols[f + 1] : 0);
        if (adj === 0) score -= 20;
      }
      if (bPawnCols[f] > 0) {
        const adj = (f > 0 ? bPawnCols[f - 1] : 0) + (f < 7 ? bPawnCols[f + 1] : 0);
        if (adj === 0) score += 20;
      }
    }

    // === Passed pawns ===
    for (const wp of wPawns) {
      let passed = true;
      for (const bp of bPawns) {
        if (Math.abs(bp.c - wp.c) <= 1 && bp.r < wp.r) { passed = false; break; }
      }
      if (passed) score += PASSED_PAWN_BONUS[wp.r];
    }
    for (const bp of bPawns) {
      let passed = true;
      for (const wp of wPawns) {
        if (Math.abs(wp.c - bp.c) <= 1 && wp.r > bp.r) { passed = false; break; }
      }
      if (passed) score -= PASSED_PAWN_BONUS[7 - bp.r];
    }

    // === Rook on open / semi-open files ===
    for (const c of wRookCols) {
      if (wPawnCols[c] === 0 && bPawnCols[c] === 0) score += 25;
      else if (wPawnCols[c] === 0) score += 12;
    }
    for (const c of bRookCols) {
      if (wPawnCols[c] === 0 && bPawnCols[c] === 0) score -= 25;
      else if (bPawnCols[c] === 0) score -= 12;
    }

    // === King safety (middlegame) ===
    if (phase > 0.4) {
      const wk = game.findKing('w');
      const bk = game.findKing('b');
      if (wk) score += this._pawnShield(game, wk[0], wk[1], 'w') * phase;
      if (bk) score -= this._pawnShield(game, bk[0], bk[1], 'b') * phase;
    }

    return score;
  }

  // MVV-LVA move ordering with TT hash move priority
  _orderMoves(game, moves, hashMove) {
    return moves.sort((a, b) => {
      // Hash move always first
      if (hashMove) {
        const aHash = a.fr === hashMove.fr && a.fc === hashMove.fc && a.tr === hashMove.tr && a.tc === hashMove.tc;
        const bHash = b.fr === hashMove.fr && b.fc === hashMove.fc && b.tr === hashMove.tr && b.tc === hashMove.tc;
        if (aHash) return -1;
        if (bHash) return 1;
      }
      // Promotions high priority
      const promoA = a.promo ? PIECE_VAL[a.promo] : 0;
      const promoB = b.promo ? PIECE_VAL[b.promo] : 0;
      // MVV-LVA: capture value = victim value * 10 - attacker value
      const capA = game.board[a.tr][a.tc];
      const capB = game.board[b.tr][b.tc];
      const pieceA = game.board[a.fr][a.fc];
      const pieceB = game.board[b.fr][b.fc];
      const scoreA = (capA ? PIECE_VAL[capA.t] * 10 - PIECE_VAL[pieceA.t] : 0) + promoA;
      const scoreB = (capB ? PIECE_VAL[capB.t] * 10 - PIECE_VAL[pieceB.t] : 0) + promoB;
      return scoreB - scoreA;
    });
  }

  // Quiescence search: resolve tactical sequences to avoid horizon effect
  quiescence(game, alpha, beta, maximizing, level, qDepth) {
    this.nodes++;

    // Stand pat evaluation
    const standPat = this.evaluate(game, level);

    // Depth limit to avoid runaway searches
    if (qDepth <= 0) return standPat;

    if (maximizing) {
      if (standPat >= beta) return beta;
      if (standPat > alpha) alpha = standPat;
    } else {
      if (standPat <= alpha) return alpha;
      if (standPat < beta) beta = standPat;
    }

    // Generate only captures and promotions
    const allMoves = game.allLegalMoves();
    const captures = allMoves.filter(m => game.board[m.tr][m.tc] || m.ep || m.promo);
    if (captures.length === 0) return standPat;

    this._orderMoves(game, captures, null);

    for (const m of captures) {
      // Delta pruning: skip if capture can't possibly raise score enough
      const capVal = game.board[m.tr][m.tc] ? PIECE_VAL[game.board[m.tr][m.tc].t] : 0;
      const promoVal = m.promo ? PIECE_VAL[m.promo] - PIECE_VAL.P : 0;
      if (maximizing && standPat + capVal + promoVal + 200 < alpha) continue;
      if (!maximizing && standPat - capVal - promoVal - 200 > beta) continue;

      game.makeMove(m);
      const score = this.quiescence(game, alpha, beta, !maximizing, level, qDepth - 1);
      game.undoMove();

      if (maximizing) {
        if (score > alpha) alpha = score;
        if (alpha >= beta) return beta;
      } else {
        if (score < beta) beta = score;
        if (alpha >= beta) return alpha;
      }
    }

    return maximizing ? alpha : beta;
  }

  // TT store with size management
  _ttStore(hash, depth, score, flag, bestMove) {
    const existing = this.tt[hash];
    // Replace if deeper or same depth
    if (!existing || existing.depth <= depth) {
      if (!existing) this.ttWrites++;
      this.tt[hash] = { depth, score, flag, bestMove };
      // Simple cleanup if too large
      if (this.ttWrites > this.maxTTEntries) {
        this.tt = {};
        this.ttWrites = 0;
      }
    }
  }

  // Enhanced minimax with alpha-beta, TT, null move pruning, and quiescence
  minimax(game, depth, alpha, beta, maximizing, level, doNull) {
    this.nodes++;

    const origAlpha = alpha;

    // Transposition table lookup
    const hash = game._posHash();
    const ttEntry = this.tt[hash];
    if (ttEntry && ttEntry.depth >= depth) {
      if (ttEntry.flag === 'exact') return ttEntry.score;
      if (ttEntry.flag === 'lower' && ttEntry.score > alpha) alpha = ttEntry.score;
      if (ttEntry.flag === 'upper' && ttEntry.score < beta) beta = ttEntry.score;
      if (alpha >= beta) return ttEntry.score;
    }

    // Leaf node: drop into quiescence search
    if (depth <= 0) return this.quiescence(game, alpha, beta, maximizing, level, 8);

    const inCheck = game.inCheck(game.turn);
    const moves = game.allLegalMoves();

    if (moves.length === 0) {
      if (inCheck) return maximizing ? -99999 + (100 - depth) : 99999 - (100 - depth);
      return 0; // stalemate
    }

    // Check extension: search one ply deeper when in check
    if (inCheck) depth++;

    // Null move pruning (skip our turn; if still good, prune)
    // Only for levels 4+, not in check, and we have non-pawn material
    if (doNull && depth >= 3 && level >= 4 && !inCheck) {
      let hasNonPawn = false;
      outer: for (let r = 0; r < 8; r++)
        for (let c = 0; c < 8; c++) {
          const p = game.board[r][c];
          if (p && p.c === game.turn && p.t !== 'K' && p.t !== 'P') { hasNonPawn = true; break outer; }
        }

      if (hasNonPawn) {
        const savedTurn = game.turn;
        const savedEP = game.enPassant;
        game.turn = game.turn === 'w' ? 'b' : 'w';
        game.enPassant = null;

        const R = depth >= 6 ? 3 : 2;
        const nullScore = this.minimax(game, depth - 1 - R, alpha, beta, !maximizing, level, false);

        game.turn = savedTurn;
        game.enPassant = savedEP;

        if (maximizing && nullScore >= beta) return beta;
        if (!maximizing && nullScore <= alpha) return alpha;
      }
    }

    // Move ordering: hash move first, then MVV-LVA
    const hashMove = ttEntry ? ttEntry.bestMove : null;
    this._orderMoves(game, moves, hashMove);

    let bestMove = moves[0];
    let bestScore = maximizing ? -Infinity : Infinity;

    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      const isCapture = !!game.board[m.tr][m.tc] || m.ep;
      const isQuiet = !isCapture && !m.promo && !m.castle;
      game.makeMove(m);

      let score;
      // Late move reduction for quiet moves (level 5 only)
      if (level >= 5 && i >= 4 && depth >= 3 && !inCheck &&
          isQuiet && !game.inCheck(game.turn)) {
        // Search with reduced depth first
        score = this.minimax(game, depth - 2, alpha, beta, !maximizing, level, true);
        // Re-search at full depth if promising
        if (maximizing ? score > alpha : score < beta) {
          score = this.minimax(game, depth - 1, alpha, beta, !maximizing, level, true);
        }
      } else {
        score = this.minimax(game, depth - 1, alpha, beta, !maximizing, level, true);
      }

      game.undoMove();

      if (maximizing) {
        if (score > bestScore) { bestScore = score; bestMove = m; }
        alpha = Math.max(alpha, score);
        if (alpha >= beta) break;
      } else {
        if (score < bestScore) { bestScore = score; bestMove = m; }
        beta = Math.min(beta, score);
        if (alpha >= beta) break;
      }
    }

    // Store in transposition table
    let flag;
    if (bestScore <= origAlpha) flag = 'upper';
    else if (maximizing ? bestScore >= beta : bestScore <= alpha) flag = 'lower';
    else flag = 'exact';
    this._ttStore(hash, depth, bestScore, flag, bestMove);

    return bestScore;
  }

  getBestMove(game, difficulty, moveLog = []) {
    const moves = game.allLegalMoves();
    if (moves.length === 0) return null;

    // Check opening book for levels 3+
    if (difficulty >= 3) {
      const historyStr = moveLog.map(m => m.replace(/[+#]/g, '')).join(' ');
      if (OPENING_BOOK[historyStr]) {
        const options = OPENING_BOOK[historyStr];
        const pick = options[Math.floor(Math.random() * options.length)];
        const match = moves.find(m => {
          const san = game.moveNotation(m);
          return san.replace(/[+#]/g, '') === pick;
        });
        if (match) return match;
      }
    }

    // Level 1: Random
    if (difficulty === 1) return moves[Math.floor(Math.random() * moves.length)];

    // Level 2: Greedy captures
    if (difficulty === 2) {
      const captures = moves.filter(m => game.board[m.tr][m.tc] || m.ep);
      if (captures.length > 0) {
        captures.sort((a, b) => {
          const va = game.board[a.tr][a.tc] ? PIECE_VAL[game.board[a.tr][a.tc].t] : 100;
          const vb = game.board[b.tr][b.tc] ? PIECE_VAL[game.board[b.tr][b.tc].t] : 100;
          return vb - va;
        });
        return captures[0];
      }
      return moves[Math.floor(Math.random() * moves.length)];
    }

    // Levels 3-5: Full search with increasing strength
    //   3 — Depth 3 + quiescence + PST
    //   4 — Depth 3 + quiescence + full eval + null move pruning
    //   5 — Depth 4 + quiescence + full eval + null move + check extensions
    const config = {
      3: { depth: 3, nullMove: false },
      4: { depth: 3, nullMove: true },
      5: { depth: 4, nullMove: true }
    };
    const cfg = config[difficulty] || config[3];

    this.nodes = 0;
    this.clearTT();

    const maximizing = game.turn === 'w';
    let bestScore = maximizing ? -Infinity : Infinity;
    let bestMoves = [];

    this._orderMoves(game, moves, null);

    for (const m of moves) {
      game.makeMove(m);
      const score = this.minimax(game, cfg.depth - 1, -Infinity, Infinity, !maximizing, difficulty, cfg.nullMove);
      game.undoMove();
      if ((maximizing && score > bestScore) || (!maximizing && score < bestScore)) {
        bestScore = score;
        bestMoves = [m];
      } else if (score === bestScore) {
        bestMoves.push(m);
      }
    }

    return bestMoves[Math.floor(Math.random() * bestMoves.length)];
  }
}

// ==================== UI CONTROLLER ====================
class ChessUI {
  constructor() {
    this.game = new ChessGame();
    this.ai = new ChessAI();
    this.sound = new SoundEngine();
    this.playerColor = 'w';
    this.difficulty = 3;
    this.flipped = false;
    this.selected = null;
    this.legalMoves = [];
    this.lastMove = null;
    this.moveLog = [];
    this.capturedW = [];
    this.capturedB = [];
    this.aiThinking = false;
    this.animating = false;
    this.dragging = null; // { piece, r, c, ghost, originX, originY, lastSq }

    this._bindDOM();
    this._applyTheme(this.themeSel.value);
    this.render();
  }

  _bindDOM() {
    this.boardEl = document.getElementById('board');
    this.turnEl = document.getElementById('turn-indicator');
    this.historyEl = document.getElementById('move-history');
    this.capTopEl = document.getElementById('captured-top');
    this.capBotEl = document.getElementById('captured-bottom');
    this.scoreTopEl = document.getElementById('score-top');
    this.scoreBotEl = document.getElementById('score-bottom');
    this.thinkingEl = document.getElementById('thinking');
    this.promoOverlay = document.getElementById('promotion-overlay');
    this.promoChoices = document.getElementById('promotion-choices');
    this.goOverlay = document.getElementById('gameover-overlay');
    this.goTitle = document.getElementById('gameover-title');
    this.goMsg = document.getElementById('gameover-message');
    this.diffSel = document.getElementById('difficulty-select');
    this.colorSel = document.getElementById('color-select');
    this.themeSel = document.getElementById('theme-select');
    this.evalBlack = document.getElementById('eval-black');
    this.evalWhite = document.getElementById('eval-white');
    this.evalLabel = document.getElementById('eval-label');

    document.getElementById('btn-new').addEventListener('click', () => this.newGame());
    document.getElementById('btn-undo').addEventListener('click', () => this.undoMove());
    document.getElementById('btn-flip').addEventListener('click', () => this.flipBoard());
    document.getElementById('btn-gameover-new').addEventListener('click', () => {
      this.goOverlay.classList.add('hidden'); this.newGame();
    });
    this.diffSel.addEventListener('change', () => { this.difficulty = parseInt(this.diffSel.value); });
    this.colorSel.addEventListener('change', () => { this.playerColor = this.colorSel.value; this.newGame(); });
    this.themeSel.addEventListener('change', () => this._applyTheme(this.themeSel.value));

    // Touch: initialize audio context on first interaction
    document.addEventListener('touchstart', () => this.sound._ctx(), { once: true });
    document.addEventListener('click', () => this.sound._ctx(), { once: true });

    // Global drag events
    document.addEventListener('mousemove', (e) => this._onDragMove(e));
    document.addEventListener('touchmove', (e) => this._onDragMove(e), { passive: false });
    document.addEventListener('mouseup', (e) => this._onDragEnd(e));
    document.addEventListener('touchend', (e) => this._onDragEnd(e));
  }

  _applyTheme(theme) {
    const board = this.boardEl;
    board.className = board.className.replace(/theme-\w+/g, '').trim();
    board.classList.add('board', 'theme-' + theme);
  }

  newGame() {
    this.game.reset();
    this.selected = null;
    this.legalMoves = [];
    this.lastMove = null;
    this.moveLog = [];
    this.capturedW = [];
    this.capturedB = [];
    this.aiThinking = false;
    this.animating = false;
    this.difficulty = parseInt(this.diffSel.value);
    this.playerColor = this.colorSel.value;
    this.flipped = this.playerColor === 'b';
    this.goOverlay.classList.add('hidden');
    this.thinkingEl.classList.add('hidden');
    // Clean up any leftover ghosts
    document.querySelectorAll('.ghost-piece').forEach(g => g.remove());
    this.render();
    if (this.playerColor !== this.game.turn) {
      setTimeout(() => this.aiMove(), 200);
    }
  }

  flipBoard() { this.flipped = !this.flipped; this.render(); }

  render() {
    this._renderBoard();
    this._renderLabels();
    this._renderTurn();
    this._renderHistory();
    this._renderCaptured();
    this._renderEval();
  }

  // ---- Board rendering ----
  _getSquareEl(r, c) {
    return this.boardEl.querySelector(`[data-r="${r}"][data-c="${c}"]`);
  }

  _renderBoard() {
    this.boardEl.innerHTML = '';
    for (let i = 0; i < 64; i++) {
      const r = this.flipped ? 7 - Math.floor(i / 8) : Math.floor(i / 8);
      const c = this.flipped ? 7 - (i % 8) : (i % 8);
      const isLight = (r + c) % 2 === 0;
      const sq = document.createElement('div');
      sq.className = 'square ' + (isLight ? 'light' : 'dark');
      sq.dataset.r = r;
      sq.dataset.c = c;

      if (this.lastMove && ((r === this.lastMove.fr && c === this.lastMove.fc) || (r === this.lastMove.tr && c === this.lastMove.tc)))
        sq.classList.add('last-move');
      if (this.selected && r === this.selected[0] && c === this.selected[1])
        sq.classList.add('selected');

      const king = this.game.findKing(this.game.turn);
      if (king && this.game.inCheck(this.game.turn) && r === king[0] && c === king[1])
        sq.classList.add('check');

      const piece = this.game.board[r][c];
      if (piece) {
        const span = document.createElement('span');
        span.className = 'piece ' + (piece.c === 'w' ? 'white-piece' : 'black-piece');
        span.textContent = PIECE_CHAR[piece.c + piece.t];
        sq.appendChild(span);
      }

      const isLegal = this.legalMoves.some(m => m.tr === r && m.tc === c);
      if (isLegal) {
        const dot = document.createElement('div');
        dot.className = piece ? 'capture-ring' : 'move-dot';
        sq.appendChild(dot);
      }

      // Instead of click on the square, we listen to pointer down events
      sq.addEventListener('mousedown', (e) => this._onPointerDown(e, r, c));
      sq.addEventListener('touchstart', (e) => this._onPointerDown(e, r, c), { passive: false });
      
      this.boardEl.appendChild(sq);
    }
  }

  _renderLabels() {
    const rl = document.getElementById('rank-labels');
    const fl = document.getElementById('file-labels');
    rl.innerHTML = ''; fl.innerHTML = '';
    for (let i = 0; i < 8; i++) {
      const rSpan = document.createElement('span');
      rSpan.textContent = this.flipped ? (i + 1) : (8 - i);
      rl.appendChild(rSpan);
      const fSpan = document.createElement('span');
      fSpan.textContent = this.flipped ? FILES[7 - i] : FILES[i];
      fl.appendChild(fSpan);
    }
  }

  _renderTurn() {
    if (this.game.gameOver) {
      this.turnEl.textContent = this.game.resultReason + ' — ' + this.game.result;
      this.turnEl.className = 'turn-indicator game-over';
    } else {
      const isWhite = this.game.turn === 'w';
      const who = (this.game.turn === this.playerColor) ? 'Your' : "AI's";
      this.turnEl.textContent = `${who} turn (${isWhite ? 'White' : 'Black'})`;
      this.turnEl.className = 'turn-indicator' + (isWhite ? '' : ' black-turn');
    }
  }

  _renderHistory() {
    this.historyEl.innerHTML = '';
    for (let i = 0; i < this.moveLog.length; i += 2) {
      const row = document.createElement('div');
      row.className = 'move-row';
      const num = document.createElement('span');
      num.className = 'move-num'; num.textContent = (i / 2 + 1) + '.';
      row.appendChild(num);
      const w = document.createElement('span');
      w.className = 'move-cell' + (i === this.moveLog.length - 1 ? ' last' : '');
      w.textContent = this.moveLog[i]; row.appendChild(w);
      if (i + 1 < this.moveLog.length) {
        const b = document.createElement('span');
        b.className = 'move-cell' + (i + 1 === this.moveLog.length - 1 ? ' last' : '');
        b.textContent = this.moveLog[i + 1]; row.appendChild(b);
      }
      this.historyEl.appendChild(row);
    }
    this.historyEl.scrollTop = this.historyEl.scrollHeight;
  }

  _renderCaptured() {
    const pieceOrder = { Q: 0, R: 1, B: 2, N: 3, P: 4 };
    const sortPieces = arr => [...arr].sort((a, b) => pieceOrder[a] - pieceOrder[b]);
    const topPieces = this.flipped ? this.capturedB : this.capturedW;
    const botPieces = this.flipped ? this.capturedW : this.capturedB;
    this.capTopEl.innerHTML = sortPieces(topPieces).map(t => PIECE_CHAR[(this.flipped ? 'b' : 'w') + t]).join('');
    this.capBotEl.innerHTML = sortPieces(botPieces).map(t => PIECE_CHAR[(this.flipped ? 'w' : 'b') + t]).join('');
    const wScore = this.capturedB.reduce((s, t) => s + PIECE_VAL[t], 0);
    const bScore = this.capturedW.reduce((s, t) => s + PIECE_VAL[t], 0);
    const diff = wScore - bScore;
    this.scoreTopEl.textContent = (this.flipped ? -diff : diff) > 0 ? '+' + Math.abs(diff / 100) : '';
    this.scoreBotEl.textContent = (this.flipped ? diff : -diff) > 0 ? '+' + Math.abs(diff / 100) : '';
  }

  // ---- Eval bar ----
  _renderEval() {
    // Simple material count for the eval bar
    let score = 0;
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++) {
        const p = this.game.board[r][c];
        if (p && p.t !== 'K') score += (p.c === 'w' ? 1 : -1) * PIECE_VAL[p.t];
      }
    // Convert centipawns to pawns
    const evalPawns = score / 100;
    // Map to percentage (0 = black winning, 100 = white winning)
    // Use a sigmoid-like mapping: ±5 pawns → ~95%
    const pct = 50 + 50 * (2 / (1 + Math.exp(-evalPawns * 0.6)) - 1);
    const whitePct = Math.max(2, Math.min(98, pct));
    const blackPct = 100 - whitePct;

    // Flip orientation: if board is flipped, white is on top
    if (this.flipped) {
      this.evalWhite.style.flex = blackPct;
      this.evalBlack.style.flex = whitePct;
    } else {
      this.evalBlack.style.flex = blackPct;
      this.evalWhite.style.flex = whitePct;
    }

    if (Math.abs(evalPawns) >= 0.5) {
      const sign = evalPawns > 0 ? '+' : '';
      this.evalLabel.textContent = sign + evalPawns.toFixed(1);
    } else {
      this.evalLabel.textContent = '0.0';
    }
  }

  // ---- Animation ----
  _animateMove(move, pieceInfo, callback) {
    const fromEl = this._getSquareEl(move.fr, move.fc);
    const toEl = this._getSquareEl(move.tr, move.tc);

    if (!fromEl || !toEl) { callback(); return; }

    const fromRect = fromEl.getBoundingClientRect();
    const toRect = toEl.getBoundingClientRect();

    // Determine visual piece (handle promotion)
    const displayChar = move.promo ?
      PIECE_CHAR[pieceInfo.c + move.promo] :
      PIECE_CHAR[pieceInfo.c + pieceInfo.t];
    const colorClass = pieceInfo.c === 'w' ? 'white-piece' : 'black-piece';

    // Hide the piece at destination
    const destPiece = toEl.querySelector('.piece');
    if (destPiece) destPiece.classList.add('anim-hidden');

    // Create ghost
    const ghost = document.createElement('span');
    ghost.className = 'ghost-piece ' + colorClass;
    ghost.textContent = displayChar;
    ghost.style.left = fromRect.left + 'px';
    ghost.style.top = fromRect.top + 'px';
    ghost.style.width = fromRect.width + 'px';
    ghost.style.height = fromRect.height + 'px';
    ghost.style.fontSize = (fromRect.width * 0.72) + 'px';
    document.body.appendChild(ghost);

    // Trigger transition
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      ghost.remove();
      if (destPiece) destPiece.classList.remove('anim-hidden');
      callback();
    };

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        ghost.style.left = toRect.left + 'px';
        ghost.style.top = toRect.top + 'px';
      });
    });

    ghost.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, 350); // Fallback
  }

  // ---- Sound selection ----
  _soundForMove(move, notation) {
    if (notation.includes('#') || this.game.gameOver) return 'gameover';
    if (notation.includes('+')) return 'check';
    if (move.castle) return 'castle';
    if (notation.includes('x')) return 'capture';
    return 'move';
  }

  // ---- Interaction ----
  _onPointerDown(e, r, c) {
    if (e.type === 'touchstart') e.preventDefault(); // Prevent touch issues
    if (this.game.gameOver || this.aiThinking || this.animating) return;
    if (this.game.turn !== this.playerColor) return;

    const piece = this.game.board[r][c];
    const moveTarget = this.legalMoves.find(m => m.tr === r && m.tc === c);

    if (moveTarget) {
      if (e.type === 'mousedown') e.preventDefault();
      const promoMoves = this.legalMoves.filter(m => m.tr === r && m.tc === c && m.promo);
      if (promoMoves.length > 1) { this._showPromotion(promoMoves); return; }
      this._doMove(moveTarget);
      return;
    }

    if (piece && piece.c === this.playerColor) {
      if (e.type === 'mousedown') e.preventDefault();
      this.selected = [r, c];
      this.legalMoves = this.game.getLegalMoves(r, c);
      this.render(); // highlight selection

      // Setup dragging
      const sqEl = this._getSquareEl(r, c);
      const pieceEl = sqEl.querySelector('.piece');
      if (!pieceEl) return;
      
      const rect = pieceEl.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;

      const ghost = document.createElement('span');
      ghost.className = 'drag-ghost ' + (piece.c === 'w' ? 'white-piece' : 'black-piece');
      ghost.textContent = PIECE_CHAR[piece.c + piece.t];
      ghost.style.left = rect.left + 'px';
      ghost.style.top = rect.top + 'px';
      ghost.style.width = rect.width + 'px';
      ghost.style.height = rect.height + 'px';
      ghost.style.fontSize = (rect.width * 0.72) + 'px';
      document.body.appendChild(ghost);

      pieceEl.style.opacity = '0.3'; // Dim original piece

      this.dragging = {
        r, c,
        pieceEl, ghost,
        offsetX: clientX - rect.left,
        offsetY: clientY - rect.top,
        lastSq: null
      };
      return;
    }

    this.selected = null; this.legalMoves = []; this.render();
  }

  _onDragMove(e) {
    if (!this.dragging) return;
    if (e.type === 'touchmove') e.preventDefault();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    this.dragging.ghost.style.left = (clientX - this.dragging.offsetX) + 'px';
    this.dragging.ghost.style.top = (clientY - this.dragging.offsetY) + 'px';

    // Highlight hovered square
    const el = document.elementFromPoint(clientX, clientY);
    const sq = el ? el.closest('.square') : null;
    if (this.dragging.lastSq && this.dragging.lastSq !== sq) {
      this.dragging.lastSq.classList.remove('drag-over');
    }
    if (sq) {
      sq.classList.add('drag-over');
      this.dragging.lastSq = sq;
    }
  }

  _onDragEnd(e) {
    if (!this.dragging) return;
    
    if (this.dragging.lastSq) this.dragging.lastSq.classList.remove('drag-over');
    this.dragging.pieceEl.style.opacity = '1';
    this.dragging.ghost.remove();

    const clientX = e.changedTouches ? e.changedTouches[0].clientX : e.clientX;
    const clientY = e.changedTouches ? e.changedTouches[0].clientY : e.clientY;
    
    const el = document.elementFromPoint(clientX, clientY);
    const sq = el ? el.closest('.square') : null;
    
    const dragState = this.dragging;
    this.dragging = null;

    if (sq) {
      const tr = parseInt(sq.dataset.r);
      const tc = parseInt(sq.dataset.c);
      
      if (tr === dragState.r && tc === dragState.c) return;

      const moveTarget = this.legalMoves.find(m => m.tr === tr && m.tc === tc);
      if (moveTarget) {
        const promoMoves = this.legalMoves.filter(m => m.tr === tr && m.tc === tc && m.promo);
        if (promoMoves.length > 1) { this._showPromotion(promoMoves); return; }
        this._doMove(moveTarget);
      }
    }
  }

  _showPromotion(moves) {
    this.promoOverlay.classList.remove('hidden');
    this.promoChoices.innerHTML = '';
    for (const m of moves) {
      const btn = document.createElement('button');
      const color = this.game.board[m.fr][m.fc].c;
      btn.textContent = PIECE_CHAR[color + m.promo];
      btn.addEventListener('click', () => { this.promoOverlay.classList.add('hidden'); this._doMove(m); });
      this.promoChoices.appendChild(btn);
    }
  }

  _doMove(move) {
    // Save piece info before move for animation
    const pieceInfo = { ...this.game.board[move.fr][move.fc] };
    let notation = this.game.moveNotation(move);

    // Track capture
    const cap = this.game.board[move.tr][move.tc];
    if (cap) { if (cap.c === 'w') this.capturedW.push(cap.t); else this.capturedB.push(cap.t); }
    if (move.ep) {
      const epPiece = this.game.board[move.fr][move.tc];
      if (epPiece.c === 'w') this.capturedW.push('P'); else this.capturedB.push('P');
    }

    this.game.makeMove(move);
    this.game._recHash();
    notation = this.game.addCheckSymbol(notation);
    this.moveLog.push(notation);
    this.lastMove = move;
    this.selected = null;
    this.legalMoves = [];
    this.animating = true;

    // Render the new board state (piece at destination)
    this.render();

    // Animate piece from source to destination
    this._animateMove(move, pieceInfo, () => {
      this.animating = false;
      this.sound.play(this._soundForMove(move, notation));

      if (this.game.checkGameEnd()) {
        setTimeout(() => this.sound.play('gameover'), 300);
        this._showGameOver();
        return;
      }
      if (this.game.turn !== this.playerColor) {
        setTimeout(() => this.aiMove(), 50);
      }
    });
  }

  aiMove() {
    if (this.game.gameOver) return;
    this.aiThinking = true;
    /* thinking indicator disabled */
    this.render();

    const baseDelay = { 1: 300, 2: 400, 3: 600, 4: 800, 5: 1000 };
    const jitter = { 1: 300, 2: 400, 3: 500, 4: 600, 5: 800 };
    const diff = this.difficulty;
    const minThinkMs = (baseDelay[diff] || 600) + Math.random() * (jitter[diff] || 500);
    const t0 = performance.now();

    setTimeout(() => {
      const move = this.ai.getBestMove(this.game, this.difficulty, this.moveLog);
      if (!move) { this.aiThinking = false; return; }

      const computeMs = performance.now() - t0;
      const remainingMs = Math.max(0, minThinkMs - computeMs);

      setTimeout(() => {
        const pieceInfo = { ...this.game.board[move.fr][move.fc] };
        let notation = this.game.moveNotation(move);

        const cap = this.game.board[move.tr][move.tc];
        if (cap) { if (cap.c === 'w') this.capturedW.push(cap.t); else this.capturedB.push(cap.t); }
        if (move.ep) {
          const epPiece = this.game.board[move.fr][move.tc];
          if (epPiece.c === 'w') this.capturedW.push('P'); else this.capturedB.push('P');
        }

        this.game.makeMove(move);
        this.game._recHash();
        notation = this.game.addCheckSymbol(notation);
        this.moveLog.push(notation);
        this.lastMove = move;
        this.aiThinking = false;
        this.animating = true;

        this.render();

        this._animateMove(move, pieceInfo, () => {
          this.animating = false;
          this.sound.play(this._soundForMove(move, notation));
          this.render(); // Re-render to ensure eval bar updates
          
          // Apply AI glow
          const destEl = this._getSquareEl(move.tr, move.tc);
          if (destEl) {
            const destPiece = destEl.querySelector('.piece');
            if (destPiece) {
              destPiece.classList.add('ai-glow');
              setTimeout(() => destPiece.classList.remove('ai-glow'), 1400);
            }
          }

          if (this.game.checkGameEnd()) {
            setTimeout(() => this.sound.play('gameover'), 300);
            this._showGameOver();
          }
        });
      }, remainingMs);
    }, 50);
  }

  undoMove() {
    if (this.game.history.length === 0 || this.aiThinking || this.animating) return;
    const count = (this.game.turn === this.playerColor && this.game.history.length >= 2) ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const u = this.game.undoMove();
      if (!u) break;
      this.moveLog.pop();
      const m = u.move;
      if (u.cap) {
        const arr = u.cap.c === 'w' ? this.capturedW : this.capturedB;
        const idx = arr.lastIndexOf(u.cap.t);
        if (idx !== -1) arr.splice(idx, 1);
      }
      if (m.ep && u.epCapPiece) {
        const arr = u.epCapPiece.c === 'w' ? this.capturedW : this.capturedB;
        const idx = arr.lastIndexOf('P');
        if (idx !== -1) arr.splice(idx, 1);
      }
    }
    this.lastMove = this.game.history.length > 0 ? this.game.history[this.game.history.length - 1].move : null;
    this.selected = null;
    this.legalMoves = [];
    this.game.gameOver = false;
    this.game.result = null;
    this.game.resultReason = '';
    this.goOverlay.classList.add('hidden');
    this.render();
  }

  _showGameOver() {
    this.goTitle.textContent = this.game.resultReason;
    let msg = '';
    if (this.game.result === '1-0') msg = 'White wins!';
    else if (this.game.result === '0-1') msg = 'Black wins!';
    else msg = 'Draw — ' + this.game.resultReason;
    this.goMsg.textContent = msg;
    this.goOverlay.classList.remove('hidden');
    this.render();
  }
}

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', () => {
  new ChessUI();
});
