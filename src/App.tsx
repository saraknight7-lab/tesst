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
    let newPrompts: string[] = [];
    
    // Check if the text contains the "Prompt:" keyword
    if (promptsText.includes('Prompt:')) {
      // Use regex to find all content after "Prompt:" until the next numbered section or end of string
      const regex = /Prompt:\s*([\s\S]*?)(?=\n\s*\d+\.|\n\s*Prompt:|$)/gi;
      let match;
      while ((match = regex.exec(promptsText)) !== null) {
        const p = match[1].trim();
        if (p) newPrompts.push(p);
      }
    }
    
    // Fallback if no prompts were found with the prefix or if it's just a simple list
    if (newPrompts.length === 0) {
      newPrompts = promptsText
        .split('\n')
        .map(p => p.trim())
        .filter(p => p.length > 0);
    }

    const newTasks: GenerationTask[] = newPrompts.map(p => ({
      id: Math.random().toString(36).substring(7),
      prompt: p,
      status: 'idle',
      aspectRatio: selectedAspectRatio,
    }));

    setTasks(prev => [...prev, ...newTasks]);
    setPromptsText('');
  };

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
        const fileName = `image-${i + 1}-${task.prompt.slice(0, 20).replace(/[^a-z0-9]/gi, '_')}.png`;
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
              <label className="block text-xs font-bold uppercase tracking-widest opacity-50 mb-4">Add Prompts</label>
              <textarea
                value={promptsText}
                onChange={(e) => setPromptsText(e.target.value)}
                placeholder="Enter prompts (one per line)..."
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
                disabled={!promptsText.trim()}
                className="w-full flex items-center justify-center gap-2 bg-[#f0f0f0] hover:bg-[#e5e5e5] text-black px-4 py-3 rounded-xl transition-colors disabled:opacity-50"
              >
                <Plus className="w-4 h-4" />
                <span className="font-medium">Add to Queue</span>
              </button>
            </div>

            {tasks.length > 0 && (
              <div className="flex items-center justify-between px-2">
                <span className="text-xs font-medium opacity-50">{tasks.length} items in queue</span>
                <button 
                  onClick={clearAll}
                  className="text-xs font-medium text-red-500 hover:underline"
                >
                  Clear all
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
                  {tasks.map((task) => (
                    <motion.div
                      key={task.id}
                      layout
                      initial={{ opacity: 0, scale: 0.9, y: 20 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.9, y: -20 }}
                      className="group relative bg-white rounded-3xl overflow-hidden shadow-sm border border-black/5 aspect-square"
                    >
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
                        className="absolute top-3 left-3 opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 backdrop-blur-md p-1.5 rounded-full shadow-lg hover:text-red-500"
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
