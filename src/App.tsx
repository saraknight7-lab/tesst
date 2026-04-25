/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import { GoogleGenAI } from "@google/genai";
import { 
  Download, 
  Plus, 
  Trash2, 
  Loader2, 
  Image as ImageIcon, 
  CheckCircle2, 
  AlertCircle,
  Sparkles,
  Zap,
  Settings2,
  X,
  Key
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

// Initialize Gemini AI
// Note: process.env.GEMINI_API_KEY is injected by the environment
const DEFAULT_API_KEY = process.env.GEMINI_API_KEY || '';

interface GenerationTask {
  id: string;
  prompt: string;
  status: 'idle' | 'loading' | 'success' | 'error';
  imageUrl?: string;
  error?: string;
  aspectRatio: "1:1" | "16:9" | "9:16" | "4:3" | "3:4";
}

export default function App() {
  const [promptsText, setPromptsText] = useState('');
  const [tasks, setTasks] = useState<GenerationTask[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedAspectRatio, setSelectedAspectRatio] = useState<GenerationTask['aspectRatio']>('1:1');
  
  // Custom API Key State
  const [customKey, setCustomKey] = useState<string>('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Load API key from local storage on mount
  useEffect(() => {
    const savedKey = localStorage.getItem('gemini_api_key');
    if (savedKey) {
      setCustomKey(savedKey);
    }
  }, []);

  // Update local storage when key changes
  const handleSaveKey = (key: string) => {
    setCustomKey(key);
    if (key.trim()) {
      localStorage.setItem('gemini_api_key', key);
    } else {
      localStorage.removeItem('gemini_api_key');
    }
    setIsSettingsOpen(false);
  };

  // Get the AI instance with the current key
  const ai = useMemo(() => {
    const apiKey = customKey.trim() || DEFAULT_API_KEY;
    return new GoogleGenAI({ apiKey });
  }, [customKey]);

  const handleAddPrompts = () => {
    let rawSections: string[] = [];
    
    // Attempt to split by keywords first if present
    if (promptsText.includes('Prompt:')) {
      const regex = /Prompt:\s*([\s\S]*?)(?=\s*\n\s*(Prompt:|Note:|$))/gi;
      let match;
      while ((match = regex.exec(promptsText)) !== null) {
        rawSections.push(match[1].trim());
      }
    } else {
      // Otherwise split by line
      rawSections = promptsText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    }

    const cleanPrompts = rawSections.map(p => {
      // 1. Remove timestamps: [HH:MM:SS], HH:MM AM/PM, (HH:MM), etc.
      let cleaned = p.replace(/[\[\(\{\s]*\d{1,2}:\d{2}(:\d{2})?(\s?[APM]{2})?[\]\)\}\s]*/gi, ' ');
      // 2. Remove date patterns: 2024-04-25
      cleaned = cleaned.replace(/\d{4}-\d{2}-\d{2}/g, '');
      // 3. Remove leading numbering/bullets: 1. , 2) , [3], #4, - etc.
      cleaned = cleaned.replace(/^[\s\.\-\(\[#]*\d+[\.\)\s\-\]]+/, '');
      // 4. Remove leading symbols/noise
      cleaned = cleaned.replace(/^[\s\.\-\*\+•]+/, '');
      // 5. Remove explicit markers
      cleaned = cleaned.replace(/^(Prompt|Note|Image|Description):\s*/i, '');
      
      return cleaned.trim();
    }).filter(p => {
      // Filter out items that are too short (likely noise) or just numbers
      return p.length > 2 && !/^\d+$/.test(p);
    });

    const newTasks: GenerationTask[] = cleanPrompts.map(p => ({
      id: Math.random().toString(36).substring(7),
      prompt: p,
      status: 'idle',
      aspectRatio: selectedAspectRatio,
    }));

    setTasks(prev => [...prev, ...newTasks]);
    setPromptsText('');
  };

  const currentPasteCount = useMemo(() => {
    if (!promptsText.trim()) return 0;
    // Simple line-based detection for the badge
    if (promptsText.includes('Prompt:')) {
      return (promptsText.match(/Prompt:/gi) || []).length;
    }
    return promptsText.split('\n').filter(l => l.trim().length > 2).length;
  }, [promptsText]);

  const removeTask = (id: string) => {
    setTasks(prev => prev.filter(t => t.id !== id));
  };

  const clearAll = () => {
    setTasks([]);
  };

  const generateImage = async (task: GenerationTask) => {
    try {
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: 'loading' } : t));

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [{ text: task.prompt }],
        },
        config: {
          imageConfig: {
            aspectRatio: task.aspectRatio,
          },
        },
      });

      let imageUrl = '';
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
          imageUrl = `data:image/png;base64,${part.inlineData.data}`;
          break;
        }
      }

      if (!imageUrl) throw new Error('No image generated');

      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: 'success', imageUrl } : t));
    } catch (error: any) {
      console.error('Generation error:', error);
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: 'error', error: error.message || 'Failed to generate' } : t));
    }
  };

  const generateAll = async () => {
    if (tasks.length === 0) return;
    setIsGenerating(true);
    
    // We'll process them in small batches to avoid hitting rate limits too hard
    const idleTasks = tasks.filter(t => t.status !== 'success');
    
    // Simple parallel execution for now
    await Promise.all(idleTasks.map(t => generateImage(t)));
    
    setIsGenerating(false);
  };

  const downloadAll = async () => {
    const successfulTasks = tasks.filter(t => t.status === 'success' && t.imageUrl);
    if (successfulTasks.length === 0) return;

    const zip = new JSZip();
    const folder = zip.folder("generated-images");

    for (let i = 0; i < successfulTasks.length; i++) {
      const task = successfulTasks[i];
      if (task.imageUrl) {
        const base64Data = task.imageUrl.split(',')[1];
        const fileNumber = String(i + 1).padStart(2, '0');
        const safePrompt = task.prompt.slice(0, 30).replace(/[^a-z0-9]/gi, '_');
        const fileName = `${fileNumber}_${safePrompt}.png`;
        folder?.file(fileName, base64Data, { base64: true });
      }
    }

    const content = await zip.generateAsync({ type: "blob" });
    saveAs(content, "bulk-images.zip");
  };

  return (
    <div className="min-h-screen bg-[#f5f5f5] text-[#1a1a1a] font-sans p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <header className="mb-12 flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="bg-black p-2 rounded-lg">
                <Zap className="w-5 h-5 text-white" />
              </div>
              <span className="text-xs font-bold uppercase tracking-widest opacity-50">AI Powered</span>
            </div>
            <h1 className="text-5xl font-light tracking-tight leading-none mb-2">Bulk Image <span className="font-bold">Generator</span></h1>
            <p className="text-muted text-sm max-w-md">Enter multiple prompts to generate a collection of images simultaneously using Gemini 2.5 Flash Image.</p>
          </div>
          
          <div className="flex gap-2">
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="p-3 bg-white border border-black/10 rounded-2xl shadow-sm hover:shadow-md transition-all active:scale-95"
              title="Settings"
            >
              <Settings2 className="w-5 h-5" />
            </button>
            {tasks.some(t => t.status === 'success') && (
              <button
                onClick={downloadAll}
                className="flex items-center gap-2 bg-white border border-black/10 px-6 py-3 rounded-2xl shadow-sm hover:shadow-md transition-all active:scale-95"
              >
                <Download className="w-4 h-4" />
                <span className="font-medium">Download All (.zip)</span>
              </button>
            )}
            <button
              onClick={generateAll}
              disabled={isGenerating || tasks.length === 0}
              className="flex items-center gap-2 bg-black text-white px-8 py-3 rounded-2xl shadow-lg hover:bg-black/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
            >
              {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              <span className="font-medium">{isGenerating ? 'Generating...' : 'Generate All'}</span>
            </button>
          </div>
        </header>

        {/* Settings Modal */}
        <AnimatePresence>
          {isSettingsOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsSettingsOpen(false)}
                className="absolute inset-0 bg-black/20 backdrop-blur-sm"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="relative w-full max-w-md bg-white rounded-[32px] shadow-2xl overflow-hidden border border-black/5"
              >
                <div className="p-8">
                  <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-black rounded-xl">
                        <Key className="w-5 h-5 text-white" />
                      </div>
                      <h2 className="text-xl font-bold">API Settings</h2>
                    </div>
                    <button
                      onClick={() => setIsSettingsOpen(false)}
                      className="p-2 hover:bg-black/5 rounded-full transition-colors"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  <div className="space-y-6">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-widest opacity-40 mb-2">Gemini API Key</label>
                      <input
                        type="password"
                        defaultValue={customKey}
                        placeholder="Enter your API Key..."
                        className="w-full px-4 py-4 bg-[#f9f9f9] rounded-2xl border-none focus:ring-2 focus:ring-black/5 transition-all text-sm font-mono"
                        onBlur={(e) => handleSaveKey(e.target.value)}
                      />
                      <p className="mt-3 text-[10px] leading-relaxed opacity-40">
                        Leave blank to use the default system key. Your key is stored securely in your browser's local storage.
                      </p>
                    </div>

                    <button
                      onClick={() => setIsSettingsOpen(false)}
                      className="w-full py-4 bg-black text-white rounded-2xl font-bold text-sm shadow-xl hover:shadow-black/20 transition-all active:scale-[0.98]"
                    >
                      Save Changes
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Input Section */}
          <div className="lg:col-span-4 space-y-6">
            <div className="bg-white p-6 rounded-3xl shadow-sm border border-black/5">
              <div className="flex items-center justify-between mb-4">
                <label className="block text-xs font-bold uppercase tracking-widest opacity-50">Add Prompts</label>
                {currentPasteCount > 0 && (
                  <motion.span 
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="text-[10px] bg-black text-white px-2 py-0.5 rounded-full font-bold"
                  >
                    {currentPasteCount} prompts detected
                  </motion.span>
                )}
              </div>
              <textarea
                value={promptsText}
                onChange={(e) => setPromptsText(e.target.value)}
                placeholder="Paste lists here (smart filter will remove timestamps and headers)..."
                className="w-full h-48 p-4 bg-[#f9f9f9] rounded-2xl border-none focus:ring-2 focus:ring-black/5 resize-none text-sm leading-relaxed mb-6"
              />

              <label className="block text-xs font-bold uppercase tracking-widest opacity-50 mb-4">Aspect Ratio</label>
              <div className="grid grid-cols-5 gap-2 mb-6">
                {(['1:1', '16:9', '9:16', '4:3', '3:4'] as const).map((ratio) => (
                  <button
                    key={ratio}
                    onClick={() => setSelectedAspectRatio(ratio)}
                    className={`py-2 text-[10px] font-bold rounded-lg border transition-all ${
                      selectedAspectRatio === ratio 
                        ? 'bg-black text-white border-black' 
                        : 'bg-white text-black border-black/10 hover:border-black/30'
                    }`}
                  >
                    {ratio}
                  </button>
                ))}
              </div>

              <button
                onClick={handleAddPrompts}
                disabled={!promptsText.trim() || currentPasteCount === 0}
                className="w-full flex items-center justify-center gap-2 bg-black text-white px-4 py-4 rounded-2xl transition-all disabled:opacity-30 active:scale-95 shadow-lg shadow-black/10 hover:bg-black/90"
              >
                <Plus className="w-4 h-4" />
                <span className="font-bold text-sm tracking-tight">Add {currentPasteCount > 0 ? `${currentPasteCount} Items` : 'to Queue'}</span>
              </button>
            </div>

            {tasks.length > 0 && (
              <div className="flex items-center justify-between px-2 bg-white/50 backdrop-blur-sm p-4 rounded-2xl border border-black/5">
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold uppercase tracking-widest opacity-40">Queue Status</span>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold">{tasks.length} Total</span>
                    <span className="w-1 h-1 bg-black/20 rounded-full" />
                    <span className="text-sm font-bold text-blue-600">{tasks.filter(t => t.status === 'idle').length} Pending</span>
                    <span className="w-1 h-1 bg-black/20 rounded-full" />
                    <span className="text-sm font-bold text-green-600">{tasks.filter(t => t.status === 'success').length} Ready</span>
                  </div>
                </div>
                <button 
                  onClick={clearAll}
                  className="p-2 hover:bg-red-50 text-red-500 rounded-lg transition-colors"
                  title="Clear all"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          {/* Results Grid */}
          <div className="lg:col-span-8">
            {tasks.length === 0 ? (
              <div className="h-full min-h-[400px] flex flex-col items-center justify-center border-2 border-dashed border-black/5 rounded-[40px] opacity-30">
                <ImageIcon className="w-12 h-12 mb-4" />
                <p className="text-sm font-medium">Your generation queue is empty</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <AnimatePresence mode="popLayout">
                  {tasks.map((task, index) => (
                    <motion.div
                      key={task.id}
                      layout
                      initial={{ opacity: 0, scale: 0.9, y: 20 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.9, y: -20 }}
                      className="group relative bg-white rounded-3xl overflow-hidden shadow-sm border border-black/5 aspect-square"
                    >
                      {/* Order Number Badge */}
                      <div className="absolute top-3 left-3 z-20 bg-black/80 backdrop-blur-md text-white text-[10px] font-bold px-2 py-1 rounded-lg opacity-100 group-hover:opacity-0 transition-opacity">
                        #{String(index + 1).padStart(2, '0')}
                      </div>
                      
                      {task.status === 'idle' && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
                          <div className="w-12 h-12 rounded-full bg-[#f5f5f5] flex items-center justify-center mb-4">
                            <ImageIcon className="w-6 h-6 opacity-20" />
                          </div>
                          <p className="text-xs font-medium line-clamp-2 opacity-60 mb-2">{task.prompt}</p>
                          <span className="text-[9px] font-bold px-2 py-0.5 bg-black/5 rounded-full opacity-40">{task.aspectRatio}</span>
                        </div>
                      )}

                      {task.status === 'loading' && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/80 backdrop-blur-sm z-10">
                          <Loader2 className="w-8 h-8 animate-spin mb-4" />
                          <p className="text-xs font-bold uppercase tracking-widest opacity-40">Generating...</p>
                        </div>
                      )}

                      {task.status === 'success' && task.imageUrl && (
                        <div className="relative w-full h-full">
                          <img
                            src={task.imageUrl}
                            alt={task.prompt}
                            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                            referrerPolicy="no-referrer"
                          />
                          <div className="absolute top-3 right-3 flex gap-1.5">
                            <div className="bg-white/90 backdrop-blur-md px-2 py-1 rounded-full shadow-lg">
                              <span className="text-[9px] font-bold">{task.aspectRatio}</span>
                            </div>
                            <div className="bg-white/90 backdrop-blur-md p-1.5 rounded-full shadow-lg">
                              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                            </div>
                          </div>
                          <div className="absolute inset-x-0 bottom-0 p-4 bg-gradient-to-t from-black/60 to-transparent translate-y-full group-hover:translate-y-0 transition-transform">
                            <p className="text-white text-[10px] line-clamp-2 leading-tight">{task.prompt}</p>
                          </div>
                        </div>
                      )}

                      {task.status === 'error' && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-red-50">
                          <AlertCircle className="w-8 h-8 text-red-400 mb-2" />
                          <p className="text-xs font-bold text-red-500 uppercase tracking-widest mb-1">Error</p>
                          <p className="text-[10px] text-red-400 line-clamp-2">{task.error}</p>
                        </div>
                      )}

                      <button
                        onClick={() => removeTask(task.id)}
                        className="absolute top-3 left-3 z-30 opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 backdrop-blur-md p-1.5 rounded-full shadow-lg hover:text-red-500"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
