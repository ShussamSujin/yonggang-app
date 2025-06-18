import React, { useState, useEffect, useMemo, useRef } from 'react';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, onSnapshot, query, serverTimestamp, deleteDoc, doc } from 'firebase/firestore';
import { ArrowUpTrayIcon, DocumentTextIcon, CalendarDaysIcon, UserGroupIcon, SparklesIcon, InformationCircleIcon, XCircleIcon, TrashIcon, ClockIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';

// --- Firebase 설정 ---
// [매우 중요!] 아래의 값들은 Firebase 콘솔에서 발급받은 실제 값으로 정확히 채워야 합니다.
// 이 설정이 잘못되면 'auth/invalid-api-key' 또는 유사한 오류가 발생하며 앱이 작동하지 않습니다.
//
// [오류 해결 체크리스트]
// 1. 모든 키와 ID를 Firebase 콘솔에서 복사하여 한 글자도 틀리지 않게 붙여넣었나요?
// 2. Firebase 콘솔 > Authentication > Sign-in method 탭에서 '익명' 로그인을 '사용 설정'으로 켰나요?
// 3. (고급) Firebase 콘솔 > Project Settings > General 에서 API 키에 대한 제한(예: HTTP 리퍼러)을 설정했다면, CodeSandbox의 미리보기 URL을 허용해야 할 수 있습니다. 테스트를 위해 잠시 제한을 풀어보는 것이 좋습니다.
const firebaseConfig = {
  apiKey: "YOUR_API_KEY_HERE",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// --- Firebase 초기화 --- (이 부분은 수정하지 마세요)
// 이미 초기화되었는지 확인하여 중복 초기화를 방지합니다.
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);
const db = getFirestore(app);
const appId = firebaseConfig.projectId || 'default-app-id';

// --- 헬퍼 함수: 날짜 파싱 ---
const parseApplicationEndDate = (periodString) => {
    if (!periodString || typeof periodString !== 'string') return null;
    
    const cleanedString = periodString.replace(/[^0-9.~-]/g, ''); 
    const parts = cleanedString.split('~');
    const dateStr = parts[parts.length - 1].trim(); 

    const dateParts = dateStr.match(/(\d{2,4})[.-]?(\d{1,2})[.-]?(\d{1,2})/);
    if (!dateParts) return null;

    let [_, year, month, day] = dateParts;
    if (year.length === 2) {
        year = `20${year}`;
    }
    
    month = month.padStart(2, '0');
    day = day.padStart(2, '0');

    const parsedDate = new Date(`${year}-${month}-${day}T23:59:59`);
    return isNaN(parsedDate.getTime()) ? null : parsedDate;
};

// --- 만료된 게시물 자동 삭제 함수 ---
const cleanupExpiredPosts = async (posts, currentAppId) => {
    const now = new Date();
    const postsToDelete = posts
        .filter(post => {
            const deadline = parseApplicationEndDate(post.applicationPeriod);
            return deadline && deadline < now;
        })
        .map(post => post.id);

    if (postsToDelete.length > 0) {
        console.log(`자동 삭제: ${postsToDelete.length}개의 만료된 연수 정보를 삭제합니다.`);
        const deletePromises = postsToDelete.map(postId => {
            const postRef = doc(db, 'artifacts', currentAppId, 'public', 'data', 'training_posts', postId);
            return deleteDoc(postRef).catch(err => console.error(`ID ${postId} 삭제 실패:`, err));
        });
        await Promise.all(deletePromises);
    }
};

// --- 컴포넌트들 ---
const LoadingSpinner = ({ message }) => (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex flex-col items-center justify-center z-50">
        <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-white mb-4"></div>
        <p className="text-white text-lg font-semibold">{message}</p>
    </div>
);

const MessageModal = ({ message, type, onClose }) => {
    const isError = type === 'error';
    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full mx-auto">
                <div className={`flex items-center p-4 border-b rounded-t-2xl ${isError ? 'bg-red-50' : 'bg-blue-50'}`}>
                    <div className="flex items-center">
                        {isError ? <XCircleIcon className="h-6 w-6 text-red-500 mr-3" /> : <InformationCircleIcon className="h-6 w-6 text-blue-500 mr-3" />}
                        <h3 className={`text-lg font-bold ${isError ? 'text-red-800' : 'text-blue-800'}`}>{isError ? '오류' : '알림'}</h3>
                    </div>
                </div>
                <div className="p-6 text-center whitespace-pre-wrap"><p className="text-gray-700">{message}</p></div>
                <div className="px-6 pb-4">
                    <button onClick={onClose} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg transition-colors">확인</button>
                </div>
            </div>
        </div>
    );
};

const ConfirmationModal = ({ message, onConfirm, onCancel }) => (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full mx-auto">
            <div className="p-6">
                 <h3 className="text-lg font-semibold text-gray-800 mb-2 text-center">삭제 확인</h3>
                 <p className="text-gray-700 text-center">{message}</p>
            </div>
            <div className="flex justify-end items-center px-6 pb-4 space-x-2">
                <button onClick={onCancel} className="bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold py-2 px-4 rounded-lg transition-colors">취소</button>
                <button onClick={onConfirm} className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg transition-colors">삭제</button>
            </div>
        </div>
    </div>
);

const TrainingCard = ({ post, onDelete }) => {
    const { id, summary, applicationPeriod, trainingPeriod, target, createdAt } = post;
    const date = createdAt?.toDate().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
    const deadline = parseApplicationEndDate(applicationPeriod);
    const isPast = deadline && deadline < new Date();

    return (
        <div className={`bg-white rounded-2xl shadow-lg hover:shadow-xl transition-shadow duration-300 flex flex-col border h-full ${isPast ? 'opacity-60 bg-gray-50' : 'border-gray-100'}`}>
            <div className="p-6 flex-grow">
                 <div className="flex justify-between items-center text-gray-500 text-sm mb-4">
                    <span className="flex items-center"><CalendarDaysIcon className="h-4 w-4 mr-2" />게시일: {date || '알 수 없음'}</span>
                    <button onClick={() => onDelete(id)} className="text-gray-400 hover:text-red-500 transition-colors"><TrashIcon className="h-5 w-5"/></button>
                </div>
                 {isPast && (
                    <div className="flex items-center bg-red-100 text-red-700 text-sm font-semibold px-3 py-1 rounded-full mb-4">
                        <ClockIcon className="h-4 w-4 mr-2" />
                        신청 마감
                    </div>
                 )}
                <div className="mb-4">
                    <h3 className="font-bold text-lg text-gray-800 flex items-center mb-2"><DocumentTextIcon className="h-6 w-6 mr-2 text-blue-500" />연수 개요</h3>
                    <p className="text-gray-600 bg-blue-50 p-3 rounded-lg">{summary || '정보 없음'}</p>
                </div>
                <div className="mb-4">
                    <h3 className="font-bold text-lg text-gray-800 flex items-center mb-2"><CalendarDaysIcon className="h-6 w-6 mr-2 text-red-500" />신청 기간</h3>
                    <p className="text-gray-600 bg-red-50 p-3 rounded-lg">{applicationPeriod || '정보 없음'}</p>
                </div>
                <div className="mb-4">
                    <h3 className="font-bold text-lg text-gray-800 flex items-center mb-2"><CalendarDaysIcon className="h-6 w-6 mr-2 text-green-500" />연수 기간</h3>
                    <p className="text-gray-600 bg-green-50 p-3 rounded-lg">{trainingPeriod || '정보 없음'}</p>
                </div>
            </div>
             <div className="bg-gray-50 px-6 py-4 mt-auto rounded-b-2xl">
                <div className="flex items-center justify-between text-sm text-gray-600">
                    <div className="flex items-center font-semibold bg-purple-100 text-purple-800 px-3 py-1 rounded-full">
                         <UserGroupIcon className="h-4 w-4 mr-2" />
                         <span>{target || '대상 미지정'}</span>
                    </div>
                    <div className="flex items-center text-gray-500">
                        <SparklesIcon className="h-5 w-5 text-yellow-500 mr-1" />
                        <span>AI 요약</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

// --- 메인 App 컴포넌트 ---
export default function App() {
    const [rawPosts, setRawPosts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadingMessage, setLoadingMessage] = useState('게시물을 불러오는 중...');
    const [user, setUser] = useState(null);
    const [modalInfo, setModalInfo] = useState({ show: false, message: '', type: 'info' });
    const [isPdfJsReady, setIsPdfJsReady] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(null);
    const fileInputRef = useRef(null);

    // 필터링 상태 추가
    const [filterTarget, setFilterTarget] = useState('all');
    const [searchTerm, setSearchTerm] = useState('');
    
    useEffect(() => {
        const script = document.createElement('script');
        script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.11.338/pdf.min.js";
        script.onload = () => {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${window.pdfjsLib.version}/pdf.worker.min.js`;
            setIsPdfJsReady(true);
        };
        script.onerror = () => {
             setModalInfo({ show: true, message: 'PDF 라이브러리를 불러오는데 실패했습니다. 페이지를 새로고침 해주세요.', type: 'error' });
        }
        document.body.appendChild(script);
        return () => { document.body.removeChild(script); };
    }, []);

    useEffect(() => {
        if (firebaseConfig.apiKey === "YOUR_API_KEY_HERE") {
            setLoading(false);
            setModalInfo({ show: true, message: "Firebase 설정이 필요합니다. 코드 상단의 [오류 해결 체크리스트]를 확인하고, 본인의 Firebase 프로젝트 값으로 수정해주세요.", type: 'error' });
            return;
        }

        const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
            if (currentUser) { setUser(currentUser); } 
            else {
                try { 
                    await signInAnonymously(auth); 
                } 
                catch (error) {
                    console.error("익명 로그인 실패:", error);
                    if (error.code === 'auth/invalid-api-key') {
                        setModalInfo({ 
                            show: true, 
                            message: "Firebase API 키가 유효하지 않습니다.\n\n코드 상단의 [오류 해결 체크리스트]를 따라 다음을 확인해주세요:\n1. API 키를 올바르게 복사했나요?\n2. Firebase에서 '익명 로그인'을 활성화했나요?",
                            type: 'error' 
                        });
                    } else {
                        setModalInfo({ show: true, message: `로그인에 실패했습니다: ${error.message}`, type: 'error' });
                    }
                     setLoading(false);
                }
            }
        });
        return () => unsubscribeAuth();
    }, []);
    
    useEffect(() => {
        if(user) {
            setLoading(true);
            const postsCollection = collection(db, 'artifacts', appId, 'public', 'data', 'training_posts');
            const q = query(postsCollection);
            
            const unsubscribeFirestore = onSnapshot(q, (snapshot) => {
                const postsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                setRawPosts(postsData);
                setLoading(false);

                try {
                    const cleanupRanKey = `cleanupRan_${appId}`;
                    const lastRun = localStorage.getItem(cleanupRanKey);
                    const oneDay = 24 * 60 * 60 * 1000;

                    if (!lastRun || (new Date().getTime() - parseInt(lastRun)) > oneDay) {
                        cleanupExpiredPosts(postsData, appId).then(() => {
                            console.log("만료된 게시물 정리 완료.");
                            localStorage.setItem(cleanupRanKey, new Date().getTime().toString());
                        });
                    }
                } catch (error) {
                    console.error("로컬 스토리지 접근 중 오류 발생:", error);
                }

            }, (error) => {
                console.error("데이터 수신 실패:", error);
                setModalInfo({ show: true, message: `데이터를 불러오는데 실패했습니다: ${error.message}`, type: 'error' });
                setLoading(false);
            });

            return () => unsubscribeFirestore();
        }
    }, [user]);

    const uniqueTargets = useMemo(() => {
        const targets = new Set(rawPosts.map(post => post.target || '기타'));
        return ['all', ...Array.from(targets)];
    }, [rawPosts]);

    const filteredAndSortedPosts = useMemo(() => {
        const filtered = rawPosts.filter(post => {
            const targetMatch = filterTarget === 'all' || post.target === filterTarget;
            const term = searchTerm.toLowerCase();
            const searchMatch = !term ||
                (post.summary && post.summary.toLowerCase().includes(term)) ||
                (post.target && post.target.toLowerCase().includes(term));
            return targetMatch && searchMatch;
        });

        const sorted = [...filtered].sort((a, b) => {
            const dateA = parseApplicationEndDate(a.applicationPeriod);
            const dateB = parseApplicationEndDate(b.applicationPeriod);
            const now = new Date();
            const aIsPast = dateA && dateA < now;
            const bIsPast = dateB && dateB < now;

            if (aIsPast && !bIsPast) return 1;
            if (!aIsPast && bIsPast) return -1;
            if (dateA && dateB) {
                 if(aIsPast && bIsPast) return dateB - dateA;
                 return dateA - dateB;
            }
            if (dateA) return -1;
            if (dateB) return 1;
            return (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0);
        });
        
        return sorted.reduce((acc, post) => {
            const targetGroup = post.target || '기타';
            if (!acc[targetGroup]) acc[targetGroup] = [];
            acc[targetGroup].push(post);
            return acc;
        }, {});
    }, [rawPosts, filterTarget, searchTerm]);

    const handleFileUpload = async (event) => {
        const file = event.target.files[0];
        if (!file || file.type !== 'application/pdf') {
             setModalInfo({ show: true, message: 'PDF 파일만 업로드할 수 있습니다.', type: 'info' });
            return;
        }
        if (!isPdfJsReady) {
            setModalInfo({ show: true, message: 'PDF 처리 라이브러리가 아직 로딩 중입니다. 잠시 후 다시 시도해주세요.', type: 'info' });
            return;
        }

        setLoadingMessage('PDF 텍스트를 추출 중입니다...');
        setLoading(true);

        try {
            const fileReader = new FileReader();
            fileReader.onload = async (e) => {
                try {
                    const typedarray = new Uint8Array(e.target.result);
                    const pdfDoc = await window.pdfjsLib.getDocument({ data: typedarray }).promise;
                    
                    let fullText = '';
                    for (let i = 1; i <= pdfDoc.numPages; i++) {
                        const page = await pdfDoc.getPage(i);
                        const textContent = await page.getTextContent();
                        const pageText = textContent.items.map(s => s.str).join(' ');
                        fullText += pageText + '\n\n';
                    }

                    if (!fullText.trim()) {
                        setModalInfo({ show: true, message: 'PDF에서 텍스트를 추출할 수 없습니다. 스캔된 문서일 수 있습니다.', type: 'error' });
                        setLoading(false);
                        return;
                    }
                    
                    setLoadingMessage('AI가 문서를 요약 중입니다...');
                    await callGeminiAPI(fullText);
                } catch (loadError) {
                    console.error('PDF 처리 상세 오류:', loadError);
                    setModalInfo({ show: true, message: `PDF 파일을 처리하는 중 오류가 발생했습니다. 파일이 손상되었거나 지원하지 않는 형식일 수 있습니다. (오류: ${loadError.message})`, type: 'error' });
                    setLoading(false);
                }
            };
            fileReader.readAsArrayBuffer(file);
        } catch (error) {
            console.error('파일 읽기 오류:', error);
            setModalInfo({ show: true, message: `파일을 읽는 중 오류가 발생했습니다: ${error.message}`, type: 'error' });
            setLoading(false);
        } finally {
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    const callGeminiAPI = async (text) => {
        const prompt = `주어진 연수 안내문 텍스트에서 다음 정보를 추출하여 JSON 형식으로 응답해줘. 1. summary: 연수 목적, 내용 등을 2-3 문장으로 요약. 2. applicationPeriod: 연수 '신청' 기간 (예: "2025.07.01 ~ 2025.07.15"). 3. trainingPeriod: 실제 '연수'가 진행되는 기간 (예: "2025.08.01 ~ 2025.08.15"). 4. target: 연수 대상 (예: "초등 교원", "중등 수학 교사", "전체 교직원"). 정보가 없으면 빈 문자열로 응답. \n\n---텍스트 시작---\n${text}\n---텍스트 끝---`;
        const payload = {
            contents: [{ 
                role: "user", 
                parts: [{ text: prompt }] 
            }],
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: "OBJECT", properties: {
                        "summary": { "type": "STRING" }, "applicationPeriod": { "type": "STRING" },
                        "trainingPeriod": { "type": "STRING" }, "target": { "type": "STRING" }
                    }, required: ["summary", "applicationPeriod", "trainingPeriod", "target"]
                }
            }
        };
        const apiKey = ""; 
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

        try {
            const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            if (!response.ok) throw new Error(`API 요청 실패: ${response.status}`);
            const result = await response.json();
            if (result.candidates?.[0]?.content?.parts?.[0]) {
                const summaryData = JSON.parse(result.candidates[0].content.parts[0].text);
                await saveSummaryToFirestore(summaryData);
                setModalInfo({ show: true, message: '연수 정보가 성공적으로 추가되었습니다.', type: 'info' });
            } else { throw new Error("API에서 유효한 요약 데이터를 받지 못했습니다."); }
        } catch (error) {
            console.error("Gemini API 호출 오류:", error);
            setModalInfo({ show: true, message: `AI 요약 중 오류가 발생했습니다: ${error.message}`, type: 'error' });
        } finally { setLoading(false); }
    };
    
    const saveSummaryToFirestore = async (summaryData) => {
        try {
            const postsCollection = collection(db, 'artifacts', appId, 'public', 'data', 'training_posts');
            await addDoc(postsCollection, { ...summaryData, createdAt: serverTimestamp() });
        } catch (error) { throw new Error(`DB 저장 실패: ${error.message}`); }
    };
    
    const handleDeletePost = (postId) => { setConfirmDelete(postId); };

    const executeDelete = async () => {
        if (!confirmDelete) return;
        setLoading(true);
        setLoadingMessage('게시물을 삭제하는 중...');
        try {
            const postRef = doc(db, 'artifacts', appId, 'public', 'data', 'training_posts', confirmDelete);
            await deleteDoc(postRef);
            setModalInfo({ show: true, message: '게시물이 삭제되었습니다.', type: 'info' });
        } catch (error) {
            setModalInfo({ show: true, message: `삭제 오류: ${error.message}`, type: 'error' });
        } finally {
            setConfirmDelete(null);
            setLoading(false);
        }
    };

    const handleCloseModal = () => setModalInfo({ show: false, message: '', type: 'info' });

    return (
        <div className="bg-gray-100 min-h-screen font-sans">
            {loading && <LoadingSpinner message={loadingMessage} />}
            {modalInfo.show && <MessageModal message={modalInfo.message} type={modalInfo.type} onClose={handleCloseModal} />}
            {confirmDelete && <ConfirmationModal message="정말로 이 게시물을 삭제하시겠습니까?" onConfirm={executeDelete} onCancel={() => setConfirmDelete(null)} />}

            <header className="bg-white shadow-md sticky top-0 z-20">
                <div className="container mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between items-center py-4">
                        <h1 className="text-2xl sm:text-3xl font-bold text-gray-800">용강중학교 연수 알리미</h1>
                        <label htmlFor="pdf-upload" className={`transition-all duration-300 cursor-pointer bg-blue-600 text-white font-bold py-2 px-4 rounded-lg flex items-center shadow-sm ${!isPdfJsReady ? 'opacity-50 cursor-not-allowed' : 'hover:bg-blue-700 hover:shadow-md transform hover:-translate-y-0.5'}`}>
                            <ArrowUpTrayIcon className="h-5 w-5 mr-2" />
                            <span>{isPdfJsReady ? 'PDF 공문 업로드' : '준비 중...'}</span>
                        </label>
                        <input id="pdf-upload" type="file" className="hidden" accept=".pdf" onChange={handleFileUpload} ref={fileInputRef} disabled={!isPdfJsReady}/>
                    </div>
                </div>
            </header>
            
            <div className="bg-gray-50/80 backdrop-blur-sm sticky top-[72px] z-10">
                <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-3">
                    <div className="flex flex-col sm:flex-row gap-4">
                        <div className="relative flex-1">
                            <label htmlFor="search-term" className="sr-only">검색</label>
                            <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 -translate-y-1/2 left-3 h-5 w-5 text-gray-400" />
                            <input
                                type="text"
                                id="search-term"
                                placeholder="키워드로 검색..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                            />
                        </div>
                        <div className="flex-1 sm:flex-grow-0 sm:w-56">
                            <label htmlFor="filter-target" className="sr-only">연수 대상 필터</label>
                            <select
                                id="filter-target"
                                value={filterTarget}
                                onChange={(e) => setFilterTarget(e.target.value)}
                                className="w-full h-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                            >
                                {uniqueTargets.map(target => (
                                    <option key={target} value={target}>
                                        {target === 'all' ? '전체 대상' : target}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>
            </div>

            <main className="container mx-auto p-4 sm:p-6 lg:p-8">
                {Object.keys(filteredAndSortedPosts).length > 0 ? (
                    <div className="space-y-10">
                        {Object.entries(filteredAndSortedPosts).map(([target, posts]) => (
                            <section key={target}>
                                <h2 className="text-2xl font-bold text-gray-700 mb-4 pb-2 border-b-2 border-blue-200">{target}</h2>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                                    {posts.map(post => (
                                        <TrainingCard key={post.id} post={post} onDelete={handleDeletePost}/>
                                    ))}
                                </div>
                            </section>
                        ))}
                    </div>
                ) : ( !loading && (
                        <div className="text-center py-20 bg-white rounded-xl shadow">
                            <DocumentTextIcon className="mx-auto h-20 w-20 text-gray-300" />
                            <h2 className="mt-4 text-xl font-semibold text-gray-600">일치하는 연수 정보가 없습니다.</h2>
                            <p className="mt-2 text-gray-500">다른 키워드로 검색하거나 필터를 조정해보세요.</p>
                        </div>
                    )
                )}
            </main>

            <footer className="text-center py-6 text-gray-500 text-sm">
                <p>Made by Sujin Lee (Google Certified Trainer & Innovator)</p>
            </footer>
        </div>
    );
}
