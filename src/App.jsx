import React, { useState, useEffect } from 'react';
import { Calendar, Clock, CheckCircle, XCircle, Users, ArrowLeft, PlusCircle, CheckSquare, Eye, CheckCheck, CalendarDays, Home, Copy, Link, Lock, Key, RotateCcw, ShieldCheck } from 'lucide-react';

// Firebase Modules
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot } from 'firebase/firestore';

// Firebase Setup (외부 환경 변수 연동)
let app, auth, db;
try {
  const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : null;
  if (firebaseConfig) {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
  }
} catch (error) {
  console.error('Firebase init failed:', error);
}
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

const timeOptions = Array.from({ length: 48 }, (_, i) => {
  const hour = Math.floor(i / 2).toString().padStart(2, '0');
  const min = i % 2 === 0 ? '00' : '30';
  return `${hour}:${min}`;
});

export default function App() {
  // App States: 'home', 'create', 'login', 'vote', 'summary', 'admin'
  const [currentView, setCurrentView] = useState('home');
  const [isSharedView, setIsSharedView] = useState(false);
  const [user, setUser] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  
  // URL Shortening States
  const [shortUrl, setShortUrl] = useState('');
  const [isShortening, setIsShortening] = useState(false);

  // Meeting Config State
  const [isPollCreated, setIsPollCreated] = useState(false);
  const [meetingConfig, setMeetingConfig] = useState({
    title: '',
    startDate: '',
    endDate: '',
    slots: []
  });
  
  const [timeBlocks, setTimeBlocks] = useState([{ id: Date.now(), startTime: '09:00', endTime: '11:00' }]);
  const [excludedDates, setExcludedDates] = useState([]);

  // Voting State
  const [votes, setVotes] = useState({});
  const [currentUser, setCurrentUser] = useState('');

  // Admin States
  const [showAdminAuth, setShowAdminAuth] = useState(false);
  const [adminPwdInput, setAdminPwdInput] = useState('');
  const [adminAuthError, setAdminAuthError] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);

  // 1. Firebase Authentication 초기화
  useEffect(() => {
    if (!auth) return;
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (error) {
        console.error("Auth error:", error);
      }
    };
    initAuth();
    
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // 2. Firestore 실시간 데이터 동기화 (투표 내역 및 일정 설정)
  useEffect(() => {
    if (!user || !db) return;

    const pollDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'polls', 'main-poll');
    const votesDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'votes', 'main-poll');

    // 일정 정보 실시간 수신
    const unsubPoll = onSnapshot(pollDocRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setMeetingConfig(data);
        // 슬롯이 존재하는지 여부로 생성 상태 판별 (초기화 대비)
        setIsPollCreated(data.slots && data.slots.length > 0);
      }
    }, (err) => console.error(err));

    // 투표 현황 실시간 수신
    const unsubVotes = onSnapshot(votesDocRef, (docSnap) => {
      if (docSnap.exists()) {
        setVotes(docSnap.data().votes || {});
      }
    }, (err) => console.error(err));

    return () => {
      unsubPoll();
      unsubVotes();
    };
  }, [user]);

  // 공유 링크로 접속한 경우 UI 처리
  useEffect(() => {
    if (window.location.search.includes('shared=true')) {
      setIsSharedView(true);
    }
  }, []);

  // URL 단축 자동화 (일정이 생성되면 자동 실행)
  useEffect(() => {
    if (isPollCreated && !isSharedView) {
      const longUrl = `${window.location.origin}${window.location.pathname}?shared=true`;
      
      const fetchShortUrl = async () => {
        setIsShortening(true);
        try {
          const response = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(longUrl)}`);
          if (response.ok) {
            const text = await response.text();
            setShortUrl(text);
          } else {
            setShortUrl(longUrl);
          }
        } catch (error) {
          console.error("URL 단축 오류:", error);
          setShortUrl(longUrl);
        } finally {
          setIsShortening(false);
        }
      };

      fetchShortUrl();
    }
  }, [isPollCreated, isSharedView]);

  // Helper to generate dates between two dates
  const generateDates = (start, end) => {
    const dates = [];
    if (!start || !end) return dates;
    
    let currentDate = new Date(start);
    const endDate = new Date(end);
    
    while (currentDate <= endDate) {
      dates.push(currentDate.toISOString().split('T')[0]);
      currentDate.setDate(currentDate.getDate() + 1);
    }
    return dates;
  };

  // Error Message Helper
  const showError = (msg) => {
    setErrorMessage(msg);
    setTimeout(() => setErrorMessage(''), 3000);
  };

  // CREATE MEETING HANDLER (Firestore에 저장)
  const handleCreateMeeting = async (e) => {
    e.preventDefault();
    const form = e.target;
    const title = form.title.value;
    const startDate = form.startDate.value;
    const endDate = form.endDate.value;

    if (new Date(startDate) > new Date(endDate)) {
      showError('종료 날짜는 시작 날짜 이후여야 합니다.');
      return;
    }

    if (timeBlocks.length === 0) {
      showError('최소 하나 이상의 시간대를 설정해주세요.');
      return;
    }

    for (let block of timeBlocks) {
      if (block.startTime >= block.endTime) {
        showError('모든 시간대의 종료 시간은 시작 시간 이후여야 합니다.');
        return;
      }
    }

    const activeExcludedDates = excludedDates.filter(d => d.trim() !== '');
    const dates = generateDates(startDate, endDate);
    const validDates = dates.filter(d => !activeExcludedDates.includes(d));

    if (validDates.length === 0) {
      showError('설정된 기간 내에 가능한 날짜가 없습니다. 제외할 날짜를 확인해주세요.');
      return;
    }

    const slots = [];
    validDates.forEach(date => {
      timeBlocks.forEach(block => {
        slots.push(`${date} ${block.startTime} ~ ${block.endTime}`);
      });
    });

    const newConfig = { title, startDate, endDate, slots };
    
    // 로컬 State 반영 후 Firebase 데이터베이스에 저장
    setMeetingConfig(newConfig);
    setIsPollCreated(true);
    setCurrentView('home');

    if (db) {
      try {
        await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'polls', 'main-poll'), newConfig);
        await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'votes', 'main-poll'), { votes: {} });
      } catch (error) {
        console.error("Poll Creation DB Error:", error);
      }
    }
  };

  // VOTE HANDLER
  const toggleVote = async (slotKey) => {
    const currentSlotVotes = votes[slotKey] || {};
    const myCurrentVote = currentSlotVotes[currentUser];
    
    let nextVote = 'O'; 
    if (myCurrentVote === 'O') nextVote = 'X';
    else if (myCurrentVote === 'X') nextVote = null;

    const newSlotVotes = { ...currentSlotVotes };
    if (nextVote === null) {
      delete newSlotVotes[currentUser];
    } else {
      newSlotVotes[currentUser] = nextVote;
    }

    const newVotes = {
      ...votes,
      [slotKey]: newSlotVotes
    };

    setVotes(newVotes);

    if (db) {
      try {
        await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'votes', 'main-poll'), { votes: newVotes }, { merge: true });
      } catch (error) {
        console.error("Vote DB Error:", error);
      }
    }
  };

  // BULK VOTE HANDLER
  const handleBulkVote = async (voteType) => {
    const newVotes = { ...votes };
    meetingConfig.slots.forEach(slotKey => {
      const currentSlotVotes = newVotes[slotKey] ? { ...newVotes[slotKey] } : {};
      if (voteType === null) {
        delete currentSlotVotes[currentUser];
      } else {
        currentSlotVotes[currentUser] = voteType;
      }
      newVotes[slotKey] = currentSlotVotes;
    });

    setVotes(newVotes);

    if (db) {
      try {
        await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'votes', 'main-poll'), { votes: newVotes }, { merge: true });
      } catch (error) {
        console.error("Bulk Vote DB Error:", error);
      }
    }
  };

  // COPY LINK HANDLER
  const handleCopyLink = () => {
    const shareUrl = shortUrl || `${window.location.origin}${window.location.pathname}?shared=true`;
    
    const el = document.createElement('textarea');
    el.value = shareUrl;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    
    setErrorMessage('공유 링크가 성공적으로 복사되었습니다! (Ctrl+V로 붙여넣기)');
    setTimeout(() => setErrorMessage(''), 3000);
  };

  // ADMIN LOGIN HANDLER
  const handleAdminLogin = (e) => {
    e.preventDefault();
    if (adminPwdInput === 'kiba4500') {
      setShowAdminAuth(false);
      setAdminPwdInput('');
      setAdminAuthError('');
      setConfirmReset(false);
      setCurrentView('admin');
    } else {
      setAdminAuthError('비밀번호가 올바르지 않습니다.');
    }
  };

  // RESET HANDLER (초기화)
  const handleReset = async () => {
    const defaultConfig = { title: '', startDate: '', endDate: '', slots: [] };
    setMeetingConfig(defaultConfig);
    setVotes({});
    setIsPollCreated(false);
    setCurrentView('home');

    if (db) {
      try {
        await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'polls', 'main-poll'), defaultConfig);
        await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'votes', 'main-poll'), { votes: {} });
      } catch (error) {
        console.error("Reset DB Error:", error);
      }
    }
  };

  // 전역 에러 메시지 렌더러
  const renderErrorToast = () => {
    if (!errorMessage) return null;
    return (
      <div className="fixed top-4 left-1/2 transform -translate-x-1/2 bg-gray-800 text-white px-6 py-3 rounded-xl shadow-2xl z-50 flex items-center gap-2 fade-in font-semibold">
        <span className="text-xl">🔔</span> {errorMessage}
      </div>
    );
  };

  // ADMIN AUTH MODAL
  const renderAdminAuthModal = () => {
    if (!showAdminAuth) return null;
    return (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 px-4 fade-in">
        <div className="bg-white p-8 rounded-2xl shadow-2xl w-full max-w-sm transform transition-all">
          <h3 className="text-2xl font-bold mb-2 flex items-center gap-2 text-gray-800">
            <ShieldCheck className="w-7 h-7 text-indigo-600"/> 관리자 모드
          </h3>
          <p className="text-sm text-gray-500 mb-6">분석 결과 열람 및 초기화를 위해 비밀번호를 입력해주세요.</p>
          <form onSubmit={handleAdminLogin}>
            <input
              type="password"
              value={adminPwdInput}
              onChange={(e) => setAdminPwdInput(e.target.value)}
              placeholder="비밀번호"
              className="w-full p-4 border border-gray-300 rounded-xl mb-2 outline-none focus:ring-2 focus:ring-indigo-500 font-bold tracking-widest text-center"
              autoFocus
            />
            {adminAuthError && <p className="text-red-500 text-sm font-bold mb-4 text-center">{adminAuthError}</p>}
            <div className="flex gap-3 mt-6">
              <button 
                type="button" 
                onClick={() => { setShowAdminAuth(false); setAdminAuthError(''); setAdminPwdInput(''); }} 
                className="flex-1 p-3 bg-gray-100 rounded-xl font-bold text-gray-600 hover:bg-gray-200"
              >
                취소
              </button>
              <button 
                type="submit" 
                className="flex-1 p-3 bg-indigo-600 rounded-xl font-bold text-white hover:bg-indigo-700 shadow-md"
              >
                인증
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  };

  // RENDER: HOME VIEW
  const renderHome = () => (
    <div className="flex flex-col items-center justify-center space-y-8 mt-12 fade-in">
      <div className="text-center space-y-4 mb-8">
        <h1 className="text-4xl font-bold text-gray-800 flex items-center justify-center gap-3">
          <Calendar className="w-10 h-10 text-blue-600" />
          회의 일정 조사
        </h1>
        <p className="text-gray-500">모두가 참석 가능한 최적의 회의 시간을 찾아보세요.</p>
      </div>

      <div className={`grid ${isSharedView ? 'md:grid-cols-2 max-w-4xl' : 'md:grid-cols-3 max-w-5xl'} gap-6 w-full px-4`}>
        {!isSharedView && (
          <button
            onClick={() => setCurrentView('create')}
            disabled={isPollCreated}
            className={`flex flex-col items-center justify-center p-10 rounded-2xl border-2 transition-all duration-200 ${
              isPollCreated 
                ? 'border-gray-200 bg-gray-50 opacity-50 cursor-not-allowed' 
                : 'border-blue-200 bg-white hover:border-blue-500 hover:shadow-lg hover:-translate-y-1'
            }`}
          >
            <PlusCircle className={`w-16 h-16 mb-4 ${isPollCreated ? 'text-gray-400' : 'text-blue-500'}`} />
            <h2 className={`text-2xl font-semibold mb-2 ${isPollCreated ? 'text-gray-500' : 'text-gray-800'}`}>
              회의 일정 조사 설정하기
            </h2>
            <p className="text-sm text-gray-500 text-center">
              {isPollCreated ? '이미 일정이 생성되었습니다.' : '새로운 회의 일정을 만들고 시간을 설정합니다.'}
            </p>
          </button>
        )}

        <button
          onClick={() => setCurrentView('login')}
          disabled={!isPollCreated}
          className={`flex flex-col items-center justify-center p-10 rounded-2xl border-2 transition-all duration-200 ${
            !isPollCreated 
              ? 'border-gray-200 bg-gray-50 opacity-50 cursor-not-allowed' 
              : 'border-green-200 bg-white hover:border-green-500 hover:shadow-lg hover:-translate-y-1'
          }`}
        >
          <CheckSquare className={`w-16 h-16 mb-4 ${!isPollCreated ? 'text-gray-400' : 'text-green-500'}`} />
          <h2 className={`text-2xl font-semibold mb-2 ${!isPollCreated ? 'text-gray-500' : 'text-gray-800'}`}>
            회의 가능 여부 체크하기
          </h2>
          <p className="text-sm text-gray-500 text-center">
            {!isPollCreated ? '먼저 조사를 생성해주세요.' : '생성된 일정에 내 참석 가능 여부를 투표합니다.'}
          </p>
        </button>

        <button
          onClick={() => setCurrentView('summary')}
          disabled={!isPollCreated}
          className={`flex flex-col items-center justify-center p-10 rounded-2xl border-2 transition-all duration-200 ${
            !isPollCreated 
              ? 'border-gray-200 bg-gray-50 opacity-50 cursor-not-allowed' 
              : 'border-purple-200 bg-white hover:border-purple-500 hover:shadow-lg hover:-translate-y-1'
          }`}
        >
          <CalendarDays className={`w-16 h-16 mb-4 ${!isPollCreated ? 'text-gray-400' : 'text-purple-500'}`} />
          <h2 className={`text-2xl font-semibold mb-2 ${!isPollCreated ? 'text-gray-500' : 'text-gray-800'}`}>
            현재체크상황
          </h2>
          <p className="text-sm text-gray-500 text-center">
            {!isPollCreated ? '먼저 조사를 생성해주세요.' : '모든 사용자의 참석 현황을 표 형태로 종합하여 확인합니다.'}
          </p>
        </button>
      </div>

      {isPollCreated && !isSharedView && (
        <div className="mt-4 bg-white p-6 rounded-xl border border-gray-200 shadow-sm max-w-2xl w-full flex flex-col items-center fade-in">
          <h3 className="text-lg font-bold text-gray-800 mb-2">🎉 회의 일정이 생성되었습니다!</h3>
          <p className="text-sm text-gray-500 mb-4">아래 단축 링크를 복사하여 참석자들에게 공유하세요.</p>
          <div className="flex w-full gap-2">
            <div className="flex-1 flex items-center bg-gray-50 border border-gray-300 rounded-lg px-3 overflow-hidden">
              <Link className="w-4 h-4 text-gray-400 mr-2 flex-shrink-0" />
              <input 
                type="text" 
                readOnly 
                value={isShortening ? '단축 링크를 생성하는 중입니다...' : (shortUrl || `${window.location.origin}${window.location.pathname}?shared=true`)} 
                className={`w-full bg-transparent p-2 text-sm outline-none ${isShortening ? 'text-gray-400' : 'text-gray-600'}`} 
              />
            </div>
            <button 
              onClick={handleCopyLink} 
              disabled={isShortening}
              className={`${isShortening ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700'} text-white px-6 py-2 rounded-lg font-bold transition-colors flex items-center gap-2 flex-shrink-0`}
            >
              <Copy className="w-4 h-4" />
              {isShortening ? '생성 중' : '복사하기'}
            </button>
          </div>
        </div>
      )}
      
      {isPollCreated && (
        <div className="mt-4 text-center text-sm text-gray-400">
          💡 힌트: '회의 가능 여부 체크하기'를 눌러 투표를 진행하세요.
        </div>
      )}
    </div>
  );

  // RENDER: CREATE VIEW
  const renderCreate = () => (
    <div className="max-w-2xl mx-auto bg-white p-8 rounded-2xl shadow-sm border border-gray-100 mt-8 fade-in">
      <div className="flex items-center mb-6 border-b pb-4">
        <button onClick={() => setCurrentView('home')} className="mr-4 text-gray-400 hover:text-gray-700">
          <ArrowLeft className="w-6 h-6" />
        </button>
        <h2 className="text-2xl font-bold text-gray-800">새로운 일정조사 만들기</h2>
      </div>

      <form onSubmit={handleCreateMeeting} className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">회의 타이틀</label>
          <input 
            type="text" 
            name="title" 
            required
            placeholder="예: 주간 업무 보고, 프로젝트 킥오프 등"
            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">시작 날짜</label>
            <input 
              type="date" 
              name="startDate" 
              required
              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">종료 날짜</label>
            <input 
              type="date" 
              name="endDate" 
              required
              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
        </div>

        <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <Calendar className="w-4 h-4" /> 제외할 날짜 설정 (선택)
            </h3>
            <button
              type="button"
              onClick={() => setExcludedDates([...excludedDates, ''])}
              className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded hover:bg-red-200 font-medium"
            >
              + 제외 날짜 추가
            </button>
          </div>
          
          <div className="space-y-3">
            {excludedDates.map((date, index) => (
              <div key={index} className="flex items-center gap-2 bg-white p-3 rounded border border-gray-200 shadow-sm">
                <input 
                  type="date" 
                  value={date}
                  onChange={(e) => {
                    const newDates = [...excludedDates];
                    newDates[index] = e.target.value;
                    setExcludedDates(newDates);
                  }}
                  className="flex-1 p-2 border border-gray-300 rounded outline-none text-sm"
                />
                <button 
                  type="button" 
                  onClick={() => setExcludedDates(excludedDates.filter((_, i) => i !== index))}
                  className="p-2 text-red-500 hover:bg-red-50 rounded"
                >
                  <XCircle className="w-5 h-5" />
                </button>
              </div>
            ))}
          </div>
          {excludedDates.length === 0 && (
            <p className="text-xs text-gray-400 mt-1">공휴일이나 주말 등 조사에서 제외할 특정 날짜가 있다면 추가해주세요.</p>
          )}
        </div>

        <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <Clock className="w-4 h-4" /> 일일 회의 가능 시간대 설정
            </h3>
            <button
              type="button"
              onClick={() => setTimeBlocks([...timeBlocks, { id: Date.now(), startTime: '09:00', endTime: '11:00' }])}
              className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded hover:bg-blue-200 font-medium"
            >
              + 시간대 추가
            </button>
          </div>
          
          <div className="space-y-3">
            {timeBlocks.map((block, index) => (
              <div key={block.id} className="flex items-end gap-2 bg-white p-3 rounded border border-gray-200 shadow-sm">
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 mb-1">시작 시간</label>
                  <select 
                    value={block.startTime}
                    onChange={(e) => {
                      const newBlocks = [...timeBlocks];
                      newBlocks[index].startTime = e.target.value;
                      setTimeBlocks(newBlocks);
                    }}
                    className="w-full p-2 border border-gray-300 rounded outline-none text-sm"
                  >
                    {timeOptions.map((time) => <option key={time} value={time}>{time}</option>)}
                  </select>
                </div>
                <span className="mb-2 text-gray-400">~</span>
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 mb-1">종료 시간</label>
                  <select 
                    value={block.endTime}
                    onChange={(e) => {
                      const newBlocks = [...timeBlocks];
                      newBlocks[index].endTime = e.target.value;
                      setTimeBlocks(newBlocks);
                    }}
                    className="w-full p-2 border border-gray-300 rounded outline-none text-sm"
                  >
                    {timeOptions.map((time) => <option key={time} value={time}>{time}</option>)}
                  </select>
                </div>
                {timeBlocks.length > 1 && (
                  <button 
                    type="button" 
                    onClick={() => setTimeBlocks(timeBlocks.filter(b => b.id !== block.id))}
                    className="p-2 text-red-500 hover:bg-red-50 rounded"
                  >
                    <XCircle className="w-5 h-5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <button 
          type="submit" 
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-4 rounded-xl transition-colors shadow-md hover:shadow-lg"
        >
          확인 (일정 생성 완료하기)
        </button>
      </form>
    </div>
  );

  // RENDER: LOGIN VIEW (Affiliation Input)
  const renderLogin = () => (
    <div className="max-w-md mx-auto bg-white p-8 rounded-2xl shadow-sm border border-gray-100 mt-16 fade-in">
      <div className="flex items-center mb-6">
        <button onClick={() => setCurrentView('home')} className="mr-4 text-gray-400 hover:text-gray-700">
          <ArrowLeft className="w-6 h-6" />
        </button>
        <h2 className="text-2xl font-bold text-gray-800">소속 입력</h2>
      </div>
      <p className="text-gray-600 mb-6 text-sm">
        회의 일정을 체크하기 위해 본인의 소속과이름을 입력해주세요. <br/>
        (예: KIBA지재팀홍길동)
      </p>
      <form onSubmit={(e) => {
        e.preventDefault();
        const user = e.target.affiliation.value.trim();
        if(user) {
          setCurrentUser(user);
          setCurrentView('vote');
        }
      }}>
        <input 
          type="text" 
          name="affiliation" 
          required
          autoFocus
          placeholder="소속 및 이름을 입력하세요"
          className="w-full p-4 border border-gray-300 rounded-xl focus:ring-2 focus:ring-green-500 outline-none mb-4 text-lg"
        />
        <button 
          type="submit" 
          className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-4 rounded-xl transition-colors shadow-md"
        >
          입력 완료하고 일정 체크하기
        </button>
      </form>
    </div>
  );

  // RENDER: VOTE VIEW
  const renderVote = () => {
    const dates = [...new Set(meetingConfig.slots.map(s => s.substring(0, 10)))].sort();
    const uniqueTimes = [...new Set(meetingConfig.slots.map(s => s.substring(11)))];

    const hasVoted = meetingConfig.slots.length > 0 && meetingConfig.slots.some(slot => {
      const myVote = votes[slot]?.[currentUser];
      return myVote === 'O' || myVote === 'X';
    });

    return (
      <div className="max-w-5xl mx-auto mt-6 bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden fade-in">
        <div className="bg-gray-50 p-6 border-b flex justify-between items-center">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <button onClick={() => setCurrentView('home')} className="text-gray-400 hover:text-gray-700">
                <ArrowLeft className="w-5 h-5" />
              </button>
              <h2 className="text-2xl font-bold text-gray-800">{meetingConfig.title}</h2>
            </div>
            <p className="text-sm text-gray-500 ml-7">
              기간: {meetingConfig.startDate} ~ {meetingConfig.endDate}
            </p>
          </div>
          <div className="flex flex-col items-end">
            <div className="flex items-center gap-2 bg-green-100 text-green-800 px-4 py-2 rounded-full font-medium">
              <Users className="w-4 h-4" />
              현재 접속: {currentUser}
            </div>
            <button 
              onClick={() => { setCurrentUser(''); setCurrentView('login'); }}
              className="text-xs text-gray-500 mt-2 hover:underline"
            >
              소속(이름) 변경하기
            </button>
          </div>
        </div>

        <div className="p-6 bg-blue-50 border-b border-blue-100">
          <p className="text-sm text-blue-800 flex items-center gap-2 font-medium mb-2">
            💡 캘린더의 시간대 칸을 직접 클릭하여 참석 여부를 표시하세요.
          </p>
          <div className="flex gap-4 text-xs mt-2">
            <span className="flex items-center gap-1"><span className="w-4 h-4 bg-green-100 text-green-600 rounded flex items-center justify-center font-bold border border-green-200">O</span> 참석 가능</span>
            <span className="flex items-center gap-1"><span className="w-4 h-4 bg-red-100 text-red-600 rounded flex items-center justify-center font-bold border border-red-200">X</span> 참석 불가</span>
            <span className="flex items-center gap-1"><span className="w-4 h-4 bg-gray-100 text-gray-400 rounded flex items-center justify-center font-bold border border-gray-200">-</span> 미선택</span>
          </div>
        </div>

        <div className="p-4 bg-white border-b flex flex-col sm:flex-row items-center justify-between gap-4">
          <span className="font-bold text-gray-800">✅ 전체 일정 일괄 체크</span>
          <div className="flex gap-2">
            <button onClick={() => handleBulkVote('O')} className="px-4 py-2 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 font-bold border border-green-300 flex items-center gap-1">
              <CheckCircle className="w-4 h-4" /> 모두 가능
            </button>
            <button onClick={() => handleBulkVote('X')} className="px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 font-bold border border-red-300 flex items-center gap-1">
              <XCircle className="w-4 h-4" /> 모두 불가
            </button>
            <button onClick={() => handleBulkVote(null)} className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 font-bold border border-gray-300">
              선택 초기화
            </button>
          </div>
        </div>

        <div className="p-6 overflow-x-auto">
          <table className="w-full border-collapse border border-gray-200 rounded-lg text-sm min-w-[800px]">
            <thead className="bg-gray-100">
              <tr>
                <th className="border border-gray-200 p-3 text-center w-36 font-bold text-gray-700 bg-gray-50">시간 / 날짜</th>
                {dates.map(date => (
                  <th key={date} className="border border-gray-200 p-3 text-center font-bold text-gray-700 min-w-[180px]">
                    {new Date(date).toLocaleDateString('ko-KR', { weekday: 'short', month: 'short', day: 'numeric' })}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {uniqueTimes.map(time => (
                <tr key={time}>
                  <td className="border border-gray-200 p-3 text-center font-bold text-gray-600 bg-gray-50 align-middle">
                    {time}
                  </td>
                  {dates.map(date => {
                    const slotKey = `${date} ${time}`;
                    const slotVotes = votes[slotKey] || {};
                    const myVote = slotVotes[currentUser];
                    const othersVotes = Object.entries(slotVotes).filter(([user]) => user !== currentUser);

                    let bgColorClass = myVote === 'O' ? "bg-green-50 hover:bg-green-100" : myVote === 'X' ? "bg-red-50 hover:bg-red-100" : "bg-white hover:bg-gray-50";
                    let borderColorClass = myVote === 'O' ? "border-green-300 ring-1 ring-green-300" : myVote === 'X' ? "border-red-300 ring-1 ring-red-300" : "border-gray-200";

                    return (
                      <td key={date} onClick={() => toggleVote(slotKey)} className={`border p-3 align-top cursor-pointer transition-all h-32 relative group ${bgColorClass} ${borderColorClass}`}>
                        <div className="flex flex-col h-full select-none">
                          <div className={`flex items-center justify-between font-bold pb-2 border-b border-dashed ${myVote ? (myVote === 'O' ? 'border-green-300' : 'border-red-300') : 'border-gray-200'} mb-2`}>
                            <span className="text-gray-500 text-xs group-hover:text-gray-700 transition-colors">내 상태</span>
                            {myVote === 'O' ? <span className="text-green-600 flex items-center gap-1 shadow-sm bg-white px-2 py-0.5 rounded-full border border-green-200"><CheckCircle className="w-3.5 h-3.5"/> 가능</span>
                            : myVote === 'X' ? <span className="text-red-600 flex items-center gap-1 shadow-sm bg-white px-2 py-0.5 rounded-full border border-red-200"><XCircle className="w-3.5 h-3.5"/> 불가</span>
                            : <span className="text-gray-400 text-xs bg-gray-100 px-2 py-0.5 rounded-full group-hover:bg-blue-100 group-hover:text-blue-600 transition-colors">선택</span>}
                          </div>
                          <div className="flex-1">
                            {othersVotes.length === 0 ? <span className="text-gray-300 text-xs italic">-</span> : (
                              <div className="flex flex-wrap gap-1">
                                {othersVotes.map(([user, vote]) => (
                                  <span key={user} className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${vote === 'O' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                                    {user}:{vote}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {hasVoted && (
          <div className="p-6 bg-gray-50 border-t flex justify-center fade-in">
            <button onClick={() => setCurrentView('summary')} className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white font-bold py-4 px-12 rounded-xl shadow-md text-lg">
              <CheckCheck className="w-6 h-6" /> 완료
            </button>
          </div>
        )}
      </div>
    );
  };

  // RENDER: SUMMARY VIEW (종합 매트릭스 표)
  const renderSummary = () => {
    // 투표에 참여한 전체 사용자 목록 추출 (중복 제거 및 정렬)
    const allUsers = Array.from(
      new Set(Object.values(votes).flatMap(slotVotes => Object.keys(slotVotes)))
    ).sort();

    return (
      <div className="max-w-6xl mx-auto mt-6 bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden fade-in">
        <div className="bg-gray-50 p-6 border-b flex justify-between items-center">
          <div className="flex items-center gap-2">
            <button onClick={() => setCurrentView('home')} className="text-gray-400 hover:text-gray-700">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h2 className="text-2xl font-bold text-gray-800">현재체크상황</h2>
          </div>
          <div className="text-sm text-gray-500 bg-white px-4 py-2 rounded-full border shadow-sm flex items-center gap-2 font-semibold">
            <Eye className="w-4 h-4 text-purple-600" /> 실시간 종합 뷰
          </div>
        </div>

        <div className="p-6 overflow-x-auto">
          {allUsers.length === 0 ? (
            <div className="text-center py-16 bg-gray-50 rounded-xl border border-dashed border-gray-200">
              <p className="text-gray-500 font-medium">아직 투표에 참여한 사람이 없습니다.</p>
              <p className="text-sm text-gray-400 mt-2">링크를 공유하여 참석자들의 투표를 받아보세요.</p>
            </div>
          ) : (
            <table className="w-full border-collapse border border-gray-200 rounded-lg text-sm text-center">
              <thead className="bg-gray-100">
                <tr>
                  <th className="border border-gray-200 p-4 font-bold text-gray-700 whitespace-nowrap bg-gray-100 sticky left-0 z-10 shadow-[1px_0_0_0_#e5e7eb]">
                    일정 (날짜 및 시간)
                  </th>
                  {allUsers.map(user => (
                    <th key={user} className="border border-gray-200 p-4 font-bold text-gray-800 min-w-[100px]">
                      {user}
                    </th>
                  ))}
                  <th className="border border-gray-200 p-4 font-bold text-indigo-700 whitespace-nowrap bg-indigo-50">
                    참석 가능 인원
                  </th>
                </tr>
              </thead>
              <tbody>
                {meetingConfig.slots.map((slot, index) => {
                  const slotVotes = votes[slot] || {};
                  const oCount = Object.values(slotVotes).filter(v => v === 'O').length;
                  const isAllO = oCount === allUsers.length && allUsers.length > 0;

                  return (
                    <tr key={index} className="hover:bg-gray-50 transition-colors">
                      <td className={`border border-gray-200 p-3 font-semibold text-left whitespace-nowrap sticky left-0 z-10 shadow-[1px_0_0_0_#e5e7eb] ${isAllO ? 'bg-green-50 text-green-800' : 'bg-white text-gray-700'}`}>
                        {slot}
                        {isAllO && <span className="ml-2 inline-block px-2 py-0.5 bg-green-200 text-green-800 text-[10px] rounded-full">전원 참석 가능!</span>}
                      </td>
                      {allUsers.map(user => {
                        const vote = slotVotes[user];
                        return (
                          <td key={user} className="border border-gray-200 p-3">
                            {vote === 'O' ? (
                              <span className="inline-flex items-center justify-center w-8 h-8 bg-green-100 text-green-600 rounded-full font-bold shadow-sm ring-1 ring-green-300">O</span>
                            ) : vote === 'X' ? (
                              <span className="inline-flex items-center justify-center w-8 h-8 bg-red-100 text-red-500 rounded-full font-bold shadow-sm ring-1 ring-red-200">X</span>
                            ) : (
                              <span className="text-gray-300">-</span>
                            )}
                          </td>
                        );
                      })}
                      <td className={`border border-gray-200 p-3 font-bold text-base ${isAllO ? 'text-green-700 bg-green-50' : 'text-indigo-600 bg-indigo-50/30'}`}>
                        {oCount} <span className="text-xs text-gray-400 font-normal">/ {allUsers.length}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer Buttons */}
        <div className="p-6 bg-gray-50 border-t flex flex-col sm:flex-row justify-center gap-4">
          <button onClick={() => setCurrentView('home')} className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-8 rounded-xl shadow-md text-lg">
            <Home className="w-6 h-6" /> 첫화면 돌아가기
          </button>
          
          {/* 종료하기 -> 관리자모드 버튼으로 변경 */}
          <button onClick={() => setShowAdminAuth(true)} className="flex items-center justify-center gap-2 bg-gray-800 hover:bg-gray-900 text-white font-bold py-4 px-8 rounded-xl shadow-md text-lg">
            <Lock className="w-6 h-6" /> 관리자모드
          </button>
        </div>
      </div>
    );
  };

  // RENDER: ADMIN VIEW (결과 도출 및 초기화 화면)
  const renderAdmin = () => {
    // 1. 전체 참여자 추출
    const allUsers = new Set();
    Object.values(votes).forEach(slotVotes => {
      Object.keys(slotVotes).forEach(u => allUsers.add(u));
    });
    const totalUsers = allUsers.size;

    // 2. 각 시간대별 'O' 카운트 통계 및 참석 가능자 명단 추출
    const slotStats = meetingConfig.slots.map(slot => {
      const slotVotes = votes[slot] || {};
      const oUsers = Object.entries(slotVotes)
        .filter(([user, vote]) => vote === 'O')
        .map(([user]) => user);
      const oCount = oUsers.length;
      return { slot, oCount, oUsers };
    });

    // 3. 1순위 (모든 참여자가 O를 선택한 경우)
    const firstPriority = slotStats.filter(s => s.oCount === totalUsers && totalUsers > 0);
    
    // 4. 2순위 (가장 많이 참석 가능하지만 모두는 아닌 경우)
    let secondPriority = [];
    const maxOcount = Math.max(...slotStats.map(s => s.oCount));
    
    if (maxOcount > 0 && maxOcount < totalUsers) {
      secondPriority = slotStats.filter(s => s.oCount === maxOcount);
    } else if (maxOcount === totalUsers) {
      // 1순위가 존재한다면 그 다음으로 많은 사람을 찾음
      const nextMax = Math.max(...slotStats.filter(s => s.oCount < totalUsers).map(s => s.oCount));
      if (nextMax > 0) secondPriority = slotStats.filter(s => s.oCount === nextMax);
    }

    return (
      <div className="max-w-4xl mx-auto mt-6 bg-white rounded-2xl shadow-sm border border-gray-100 p-8 fade-in">
        <div className="flex items-center mb-8 pb-4 border-b">
          <button onClick={() => setCurrentView('summary')} className="mr-4 text-gray-400 hover:text-gray-700">
            <ArrowLeft className="w-6 h-6" />
          </button>
          <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <Key className="w-7 h-7 text-indigo-600" /> 관리자 모드 : 최적 일정 결산
          </h2>
        </div>

        <div className="bg-gray-50 rounded-xl p-4 mb-8 text-center border">
          <p className="text-gray-600 font-semibold">총 참여 인원 : <span className="text-indigo-600 font-bold text-lg">{totalUsers}명</span></p>
        </div>

        <div className="space-y-6 mb-10">
          {/* 1순위 결과 */}
          <div className="bg-green-50 border border-green-200 p-6 rounded-xl">
            <h3 className="text-lg font-bold text-green-800 mb-4 flex items-center gap-2">🥇 1순위 : 모두가 참석 가능한 날짜</h3>
            {firstPriority.length > 0 ? (
              <ul className="space-y-2">
                {firstPriority.map((item, i) => (
                  <li key={i} className="bg-white p-3 rounded shadow-sm border border-green-100 font-bold text-green-700 flex justify-between">
                    <span>{item.slot}</span>
                    <span className="bg-green-100 px-3 py-1 rounded-full text-sm">전원 참석 가능!</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-green-700/70 text-sm">모두가 참석 가능한 날짜가 존재하지 않습니다.</p>
            )}
          </div>

          {/* 2순위 결과 */}
          <div className="bg-blue-50 border border-blue-200 p-6 rounded-xl">
            <h3 className="text-lg font-bold text-blue-800 mb-4 flex items-center gap-2">🥈 2순위 : 최대한 많은 사람이 참석 가능한 날짜</h3>
            {secondPriority.length > 0 ? (
              <ul className="space-y-2">
                {secondPriority.map((item, i) => (
                  <li key={i} className="bg-white p-3 rounded shadow-sm border border-blue-100 flex flex-col gap-2">
                    <div className="flex justify-between items-center font-bold text-blue-700">
                      <span>{item.slot}</span>
                      <span className="bg-blue-100 px-3 py-1 rounded-full text-sm">{item.oCount}명 참석 가능</span>
                    </div>
                    {item.oUsers.length > 0 && (
                      <div className="text-sm text-gray-600 bg-gray-50 px-3 py-2 rounded-lg border border-gray-100 mt-1">
                        <span className="font-semibold text-gray-700">참석 가능자:</span> {item.oUsers.join(', ')}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-blue-700/70 text-sm">조건에 맞는 2순위 일정이 없습니다.</p>
            )}
          </div>
        </div>

        {/* 초기화 위험 구역 */}
        <div className="border-t pt-8 flex flex-col items-center">
          <p className="text-gray-500 text-sm mb-4 font-semibold">초기화를 진행하면 현재까지의 모든 일정과 투표 기록이 영구적으로 삭제됩니다.</p>
          {!confirmReset ? (
            <button 
              onClick={() => setConfirmReset(true)}
              className="flex items-center gap-2 px-8 py-4 bg-red-50 text-red-600 border border-red-200 font-bold rounded-xl hover:bg-red-100 transition-colors"
            >
              <RotateCcw className="w-5 h-5"/> 모든 설정 및 데이터 초기화
            </button>
          ) : (
            <div className="flex gap-4 animate-pulse">
              <button 
                onClick={() => setConfirmReset(false)}
                className="px-6 py-3 bg-gray-200 text-gray-700 font-bold rounded-xl hover:bg-gray-300"
              >
                취소
              </button>
              <button 
                onClick={handleReset}
                className="px-6 py-3 bg-red-600 text-white font-bold rounded-xl shadow-lg hover:bg-red-700"
              >
                진짜로 초기화하기 (복구 불가)
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50/50 font-sans p-4 md:p-8">
      {renderErrorToast()}
      {renderAdminAuthModal()}

      {currentView === 'home' && renderHome()}
      {currentView === 'create' && renderCreate()}
      {currentView === 'login' && renderLogin()}
      {currentView === 'vote' && renderVote()}
      {currentView === 'summary' && renderSummary()}
      {currentView === 'admin' && renderAdmin()}
    </div>
  );
}