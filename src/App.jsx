import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Lock, Unlock, Delete, Check, ShieldAlert, Share2, Terminal, ChevronRight, Clock } from 'lucide-react';

// --- UTILS: DAILY SEED & STORAGE ---
const getTodayStr = () => new Date().toLocaleDateString();
const getDailyCode = () => {
  const seed = new Date().toISOString().slice(0, 10).split('-').join('');
  const random = (s) => {
    const x = Math.sin(s) * 10000;
    return x - Math.floor(x);
  };
  return Array.from({ length: 5 }, (_, i) => Math.floor(random(seed + i) * 10).toString());
};

const getMidnightCountdown = () => {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const diff = midnight - now;
  const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const s = Math.floor((diff % (1000 * 60)) / 1000);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

// --- AUDIO ENGINE ---
let audioCtx = null;
const initAudio = () => {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
};

const playSound = (freq, type, dur, vol = 0.1) => {
  initAudio();
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
  gain.gain.setValueAtTime(vol, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + dur);
  osc.connect(gain); gain.connect(audioCtx.destination);
  osc.start(); osc.stop(audioCtx.currentTime + dur);
};

const sfx = {
  type: () => { playSound(800, 'sine', 0.05, 0.03); if(navigator.vibrate) navigator.vibrate(5); },
  delete: () => playSound(300, 'triangle', 0.05, 0.03),
  error: () => { playSound(150, 'sawtooth', 0.3, 0.1); if(navigator.vibrate) navigator.vibrate([30, 30, 30]); },
  reveal: (i) => setTimeout(() => playSound(600 + (i * 50), 'square', 0.1, 0.05), i * 150),
  win: () => { playSound(440, 'sine', 0.2, 0.1); setTimeout(() => playSound(659, 'sine', 0.4, 0.15), 300); },
  lose: () => playSound(80, 'sawtooth', 0.8, 0.1),
  boot: () => playSound(200, 'square', 0.2, 0.05)
};

// --- LOGIC ---
const CODE_LENGTH = 5;
const MAX_ATTEMPTS = 5;
const MAX_TIME = 60; 

const evaluateGuess = (guess, target) => {
  let result = new Array(CODE_LENGTH).fill('miss');
  let targetCopy = [...target];
  let guessCopy = [...guess];
  
  for (let i = 0; i < CODE_LENGTH; i++) {
    if (guessCopy[i] === targetCopy[i]) {
      result[i] = 'exact';
      targetCopy[i] = null;
      guessCopy[i] = null;
    }
  }
  for (let i = 0; i < CODE_LENGTH; i++) {
    if (guessCopy[i] !== null) {
      const targetIndex = targetCopy.indexOf(guessCopy[i]);
      if (targetIndex > -1) {
        result[i] = 'partial';
        targetCopy[targetIndex] = null;
      }
    }
  }
  return result;
};

export default function BruteForce() {
  const [gameState, setGameState] = useState('landing'); 
  const [targetCode, setTargetCode] = useState([]);
  const [guesses, setGuesses] = useState([]);
  const [currentGuess, setCurrentGuess] = useState([]);
  const [isRevealing, setIsRevealing] = useState(false);
  const [usedKeys, setUsedKeys] = useState({});
  const [copied, setCopied] = useState(false);
  const [timeLeft, setTimeLeft] = useState(MAX_TIME);
  const [countdownTimer, setCountdownTimer] = useState('');
  const [isShaking, setIsShaking] = useState(false);

  // --- INITIAL LOAD: CHECK DAILY LOCKOUT ---
  useEffect(() => {
    const today = getTodayStr();
    const saved = JSON.parse(localStorage.getItem('bruteforce-daily'));
    
    if (saved && saved.date === today && (saved.status === 'win' || saved.status === 'lose')) {
      setTargetCode(saved.targetCode);
      setGuesses(saved.guesses);
      setGameState('end');
    }
  }, []);

  // --- MIDNIGHT COUNTDOWN ---
  useEffect(() => {
    if (gameState !== 'end') return;
    const interval = setInterval(() => {
      setCountdownTimer(getMidnightCountdown());
    }, 1000);
    setCountdownTimer(getMidnightCountdown()); // Initial set
    return () => clearInterval(interval);
  }, [gameState]);

  // --- ACTIVE 60s TIMER ---
  useEffect(() => {
    if (gameState !== 'playing' || isRevealing) return;
    const timerId = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timerId);
          triggerError();
          sfx.lose();
          saveDailyData('lose', guesses);
          setGameState('end');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timerId);
  }, [gameState, isRevealing, guesses]);

  const triggerError = useCallback(() => {
    sfx.error();
    setIsShaking(true);
    setTimeout(() => setIsShaking(false), 400); // Shake duration
  }, []);

  const saveDailyData = (status, finalGuesses) => {
    localStorage.setItem('bruteforce-daily', JSON.stringify({
      date: getTodayStr(),
      targetCode,
      guesses: finalGuesses,
      status
    }));
  };

  const handleKeyPress = useCallback((key) => {
    if (gameState !== 'playing' || isRevealing || timeLeft <= 0) return;
    if (key === 'Backspace' || key === 'Delete') {
      if (currentGuess.length > 0) { sfx.delete(); setCurrentGuess(prev => prev.slice(0, -1)); }
    } else if (key === 'Enter') {
      if (currentGuess.length === CODE_LENGTH) submitGuess();
      else triggerError();
    } else if (/^[0-9]$/.test(key)) {
      if (currentGuess.length < CODE_LENGTH) { sfx.type(); setCurrentGuess(prev => [...prev, key]); }
    }
  }, [currentGuess, gameState, isRevealing, targetCode, timeLeft, triggerError]);

  useEffect(() => {
    const onKeyDown = (e) => handleKeyPress(e.key);
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleKeyPress]);

  const submitGuess = async () => {
    setIsRevealing(true);
    const result = evaluateGuess(currentGuess, targetCode);
    result.forEach((_, i) => sfx.reveal(i));
    
    setTimeout(() => {
      const newGuesses = [...guesses, { digits: currentGuess, result }];
      setGuesses(newGuesses);
      
      const newKeys = { ...usedKeys };
      currentGuess.forEach((digit, i) => {
        if (result[i] === 'exact') newKeys[digit] = 'exact';
        else if (result[i] === 'partial' && newKeys[digit] !== 'exact') newKeys[digit] = 'partial';
        else if (!newKeys[digit]) newKeys[digit] = 'miss';
      });
      setUsedKeys(newKeys);
      setCurrentGuess([]);
      setIsRevealing(false);

      if (result.every(r => r === 'exact')) {
        saveDailyData('win', newGuesses);
        setTimeout(() => { sfx.win(); setGameState('end'); }, 400);
      } else if (newGuesses.length >= MAX_ATTEMPTS) {
        saveDailyData('lose', newGuesses);
        setTimeout(() => { sfx.lose(); triggerError(); setGameState('end'); }, 400);
      }
    }, CODE_LENGTH * 150);
  };

  const handleStartHack = () => {
    initAudio();
    sfx.boot();
    setTargetCode(getDailyCode());
    setGuesses([]);
    setCurrentGuess([]);
    setUsedKeys({});
    setTimeLeft(MAX_TIME);
    setGameState('playing');
  };

  // --- RENDERING ---

  if (gameState === 'landing') return (
    <div className="h-screen bg-zinc-950 flex flex-col items-center justify-center p-6 text-center overflow-hidden">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-cyan-500/10 rounded-full blur-[120px] pointer-events-none" />
      <Lock className="text-cyan-400 mb-6 animate-pulse z-10" size={64} />
      <h1 className="text-6xl font-black text-white tracking-tighter mb-2 z-10">BRUTEFORCE</h1>
      <p className="text-zinc-500 font-mono text-xs tracking-[0.4em] uppercase mb-16 z-10">Security Breach Protocol</p>
      <button onClick={() => { initAudio(); sfx.type(); setGameState('rules'); }} className="w-full max-w-xs py-5 bg-cyan-500 text-black font-black text-xl rounded-2xl shadow-xl shadow-cyan-500/20 active:scale-95 transition-all z-10 cursor-pointer">INITIALIZE</button>
    </div>
  );

  if (gameState === 'rules') return (
    <div className="h-screen bg-zinc-950 flex flex-col items-center justify-center p-4 font-mono relative overflow-hidden">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-fuchsia-500/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="z-10 w-full max-w-sm bg-zinc-900/50 backdrop-blur-xl border border-zinc-800 p-6 sm:p-8 rounded-[2rem] shadow-2xl flex flex-col">
        <h2 className="text-xl font-black text-white uppercase mb-6 flex items-center gap-2 border-b border-zinc-800 pb-4"><Terminal className="text-fuchsia-500" size={24} /> Directives</h2>
        
        <div className="space-y-4 mb-8">
          <p className="text-zinc-400 text-xs leading-relaxed uppercase tracking-wider mb-2">Crack the daily 5-digit code in <span className="text-white font-bold">5 attempts</span>. You have <span className="text-red-400 font-bold">60 SECONDS</span>.</p>
          
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 shrink-0 bg-cyan-500/20 border border-cyan-500 rounded-lg flex items-center justify-center text-cyan-400 font-bold">7</div>
            <p className="text-[10px] text-zinc-300 uppercase tracking-widest font-bold">Correct digit, correct slot.</p>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 shrink-0 bg-fuchsia-500/20 border border-fuchsia-500 rounded-lg flex items-center justify-center text-fuchsia-400 font-bold">3</div>
            <p className="text-[10px] text-zinc-300 uppercase tracking-widest font-bold">Correct digit, wrong slot.</p>
          </div>

          <div className="flex items-center gap-4 opacity-60">
            <div className="w-10 h-10 shrink-0 bg-zinc-800 border border-zinc-700 rounded-lg flex items-center justify-center text-zinc-500 font-bold">9</div>
            <p className="text-[10px] text-zinc-300 uppercase tracking-widest font-bold">Digit not in sequence.</p>
          </div>
        </div>

        <button onClick={handleStartHack} className="w-full py-4 bg-white text-black font-black rounded-xl active:scale-95 flex justify-center items-center gap-2 cursor-pointer transition-colors hover:bg-zinc-200">
          <span>ENGAGE OVERRIDE</span>
          <ChevronRight size={20} />
        </button>
      </div>
    </div>
  );

  return (
    <div className="h-screen bg-zinc-950 flex flex-col items-center justify-between py-6 px-4 font-mono overflow-hidden select-none">
      <div className="w-full max-w-sm flex justify-between items-end px-2">
        <h2 className="text-cyan-500 font-bold tracking-tighter uppercase">Bruteforce</h2>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <span className="text-[10px] text-zinc-500 block font-bold">TRACE TIMER</span>
            <span className={`text-xl font-mono ${timeLeft <= 10 ? 'text-red-500 animate-pulse' : 'text-white'}`}>
              00:{timeLeft.toString().padStart(2, '0')}
            </span>
          </div>
          <div className="text-right">
            <span className="text-[10px] text-zinc-500 block font-bold">RETRIES</span>
            <span className="text-white font-mono">{MAX_ATTEMPTS - guesses.length}</span>
          </div>
        </div>
      </div>

      {/* SHAKING WRAPPER FOR THE GRID AND NUMPAD */}
      <motion.div 
        animate={isShaking ? { x: [-10, 10, -8, 8, -5, 5, 0] } : { x: 0 }}
        transition={{ duration: 0.4 }}
        className="flex-1 w-full max-w-sm flex flex-col items-center justify-center space-y-6"
      >
        
        {/* THE GRID */}
        <div className="w-full max-w-xs flex flex-col justify-center space-y-2">
          {[...Array(MAX_ATTEMPTS)].map((_, i) => (
            <div key={i} className="flex space-x-2 justify-center">
              {[...Array(CODE_LENGTH)].map((_, j) => {
                const g = guesses[i];
                const digit = g ? g.digits[j] : (i === guesses.length ? currentGuess[j] : '');
                const res = g ? g.result[j] : '';
                return (
                  <div key={j} className={`w-12 h-14 sm:w-14 sm:h-16 flex items-center justify-center rounded-xl border-2 text-2xl font-bold transition-all duration-300
                    ${res === 'exact' ? 'bg-cyan-500/20 border-cyan-500 text-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.3)]' : 
                      res === 'partial' ? 'bg-fuchsia-500/20 border-fuchsia-500 text-fuchsia-400 shadow-[0_0_15px_rgba(217,70,239,0.3)]' : 
                      res === 'miss' ? 'bg-zinc-900 border-zinc-800 text-zinc-700' : 
                      (i === guesses.length && currentGuess[j] ? 'border-zinc-500 text-white' : 'border-zinc-900 text-zinc-800')}
                  `}>{digit}</div>
                )
              })}
            </div>
          ))}
        </div>

        {/* NUMPAD */}
        <div className="w-full max-w-xs grid grid-cols-3 gap-2 p-3 bg-zinc-900/30 backdrop-blur-md rounded-[2.5rem] border border-zinc-800/50">
          {['1','2','3','4','5','6','7','8','9','DEL','0','ENT'].map(k => (
            <button key={k} onClick={() => { if(k==='DEL') handleKeyPress('Backspace'); else if(k==='ENT') handleKeyPress('Enter'); else handleKeyPress(k); }} 
              className={`h-12 sm:h-14 rounded-2xl font-bold text-xl active:scale-90 transition-all flex items-center justify-center border border-transparent cursor-pointer
              ${k === 'ENT' ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-900/20' : 'bg-zinc-800/80 text-zinc-300'}
              ${usedKeys[k] === 'exact' ? 'bg-cyan-500/20 text-cyan-400 !border-cyan-500/50' : 
                usedKeys[k] === 'partial' ? 'bg-fuchsia-500/20 text-fuchsia-400 !border-fuchsia-500/50' : 
                usedKeys[k] === 'miss' ? 'opacity-20 grayscale' : ''}
            `}>
              {k === 'DEL' ? <Delete size={20}/> : (k === 'ENT' ? <Check size={24}/> : k)}
            </button>
          ))}
        </div>

      </motion.div>

      {/* END SCREEN */}
      <AnimatePresence>
        {gameState === 'end' && (
          <div className="fixed inset-0 z-50 bg-zinc-950/98 backdrop-blur-xl flex items-center justify-center p-6">
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-zinc-900 border border-zinc-800 p-8 rounded-[3rem] text-center max-w-xs w-full shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-cyan-500 to-fuchsia-500" />
              <div className={`w-20 h-20 mx-auto rounded-3xl flex items-center justify-center mb-6 ${guesses[guesses.length-1]?.result.every(r=>r==='exact') ? 'bg-cyan-500/20 text-cyan-400 shadow-[0_0_30px_rgba(34,211,238,0.3)]' : 'bg-red-500/20 text-red-400'}`}>
                {guesses[guesses.length-1]?.result.every(r=>r==='exact') ? <Unlock size={40}/> : <ShieldAlert size={40}/>}
              </div>
              <h2 className="text-3xl font-black text-white mb-2 uppercase tracking-tighter italic">{guesses[guesses.length-1]?.result.every(r=>r==='exact') ? 'Breached' : 'Locked Out'}</h2>
              <p className="text-zinc-500 mb-8 font-mono text-sm tracking-[0.3em]">CODE: {targetCode.join('')}</p>
              
              {/* MIDNIGHT COUNTDOWN MODULE */}
              <div className="bg-zinc-950/50 rounded-2xl p-4 mb-6 border border-zinc-800">
                <div className="flex items-center justify-center gap-2 mb-2 text-zinc-500">
                  <Clock size={14} />
                  <p className="text-[10px] font-bold tracking-widest uppercase">Next Target In</p>
                </div>
                <p className="text-3xl text-cyan-400 font-mono font-bold tracking-wider animate-pulse">{countdownTimer}</p>
              </div>

              <div className="space-y-3">
                <button onClick={() => {
                  const isWin = guesses[guesses.length - 1]?.result.every(r => r === 'exact');
                  const timeStat = isWin ? `[Time: 00:${timeLeft.toString().padStart(2, '0')}]` : `[Locked]`;
                  const text = `BRUTEFORCE: ${isWin ? 'CLEARED' : 'FAILED'} ${timeStat}\nAttempts: ${guesses.length}/${MAX_ATTEMPTS}\n\n${guesses.map(g => g.result.map(r => r === 'exact' ? '🟦' : r === 'partial' ? '🟪' : '⬛').join('')).join('\n')}`;
                  navigator.clipboard.writeText(text); setCopied(true); setTimeout(()=>setCopied(false), 2000);
                }} className="w-full py-4 bg-zinc-800 text-zinc-400 font-bold rounded-2xl flex items-center justify-center gap-2 active:scale-95 transition-all cursor-pointer hover:bg-zinc-700 hover:text-white">
                  <Share2 size={18}/> {copied ? 'DATA COPIED' : 'EXFILTRATE RESULTS'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}