// Copyright 2026 Andrew Brook
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * MediaGallery — upload, view, and manage photos and documents attached to a dossier.
 * Supports image preview, captions, date/people tagging, and event linking.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { MediaItem, StoryEvent } from '../../types';
import { getMedia, uploadMedia, updateMedia, deleteMedia, getEvents } from '../../services/storage';

export const MediaGallery: React.FC = () => {
  const { familyId, dossierId } = useParams<{ familyId: string; dossierId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [items, setItems] = useState<MediaItem[]>([]);
  const [events, setEvents] = useState<StoryEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null);
  const [editingCaption, setEditingCaption] = useState('');

  // Upload form state
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadCaption, setUploadCaption] = useState('');
  const [uploadDate, setUploadDate] = useState('');
  const [uploadPeople, setUploadPeople] = useState('');

  useEffect(() => {
    if (!familyId || !dossierId) return;
    Promise.all([getMedia(familyId, dossierId), getEvents(familyId, dossierId)])
      .then(([media, evts]) => {
        setItems(media);
        setEvents(evts);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [familyId, dossierId]);

  const handleUpload = useCallback(async () => {
    if (!familyId || !dossierId || !user || !uploadFile) return;
    setUploading(true);
    try {
      await uploadMedia(familyId, dossierId, uploadFile, {
        caption: uploadCaption,
        date: uploadDate || null,
        people: uploadPeople ? uploadPeople.split(',').map((p) => p.trim()).filter(Boolean) : [],
        eventIds: [],
      }, user.uid);

      const updated = await getMedia(familyId, dossierId);
      setItems(updated);
      setShowUploadForm(false);
      setUploadFile(null);
      setUploadCaption('');
      setUploadDate('');
      setUploadPeople('');
    } catch (err) {
      console.error('[Media] Upload error:', err);
      alert('Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  }, [familyId, dossierId, user, uploadFile, uploadCaption, uploadDate, uploadPeople]);

  const handleDelete = useCallback(async (mediaId: string) => {
    if (!familyId || !dossierId) return;
    if (!confirm('Remove this media item?')) return;
    try {
      await deleteMedia(familyId, dossierId, mediaId);
      setItems((prev) => prev.filter((m) => m.id !== mediaId));
      if (selectedItem?.id === mediaId) setSelectedItem(null);
    } catch (err) {
      console.error('[Media] Delete error:', err);
    }
  }, [familyId, dossierId, selectedItem]);

  const handleSaveCaption = useCallback(async () => {
    if (!familyId || !dossierId || !selectedItem?.id) return;
    try {
      await updateMedia(familyId, dossierId, selectedItem.id, { caption: editingCaption });
      setItems((prev) => prev.map((m) => m.id === selectedItem.id ? { ...m, caption: editingCaption } : m));
      setSelectedItem((prev) => prev ? { ...prev, caption: editingCaption } : null);
    } catch (err) {
      console.error('[Media] Update error:', err);
    }
  }, [familyId, dossierId, selectedItem, editingCaption]);

  const isImage = (mimeType: string) => mimeType.startsWith('image/');

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <button
            onClick={() => navigate(`/family/${familyId}/dossier/${dossierId}`)}
            className="text-sm text-indigo-600 font-medium hover:underline mb-1"
          >
            &larr; Back to Dossier
          </button>
          <h2 className="text-2xl font-bold text-slate-800">Photos &amp; Media</h2>
          <p className="text-sm text-slate-400 mt-1">
            {items.length} item{items.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={() => setShowUploadForm(true)}
          className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 transition-colors shadow-lg"
        >
          Upload
        </button>
      </div>

      {/* Upload form */}
      {showUploadForm && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4 shadow-sm">
          <h3 className="font-semibold text-slate-800">Upload Media</h3>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.pdf,.doc,.docx"
            onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-600 hover:file:bg-indigo-100"
          />
          {uploadFile && isImage(uploadFile.type) && (
            <img
              src={URL.createObjectURL(uploadFile)}
              alt="Preview"
              className="max-h-48 rounded-xl object-cover"
            />
          )}
          <input
            type="text"
            placeholder="Caption (e.g. 'Wedding day, 1965')"
            value={uploadCaption}
            onChange={(e) => setUploadCaption(e.target.value)}
            className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <div className="grid grid-cols-2 gap-4">
            <input
              type="text"
              placeholder="Date (e.g. 1965, Summer 1972)"
              value={uploadDate}
              onChange={(e) => setUploadDate(e.target.value)}
              className="px-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <input
              type="text"
              placeholder="People (comma-separated)"
              value={uploadPeople}
              onChange={(e) => setUploadPeople(e.target.value)}
              className="px-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleUpload}
              disabled={!uploadFile || uploading}
              className="px-5 py-2 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-colors disabled:opacity-50"
            >
              {uploading ? 'Uploading...' : 'Upload'}
            </button>
            <button
              onClick={() => { setShowUploadForm(false); setUploadFile(null); }}
              className="text-sm text-slate-500 font-medium hover:underline"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Gallery grid */}
      {items.length === 0 ? (
        <div className="text-center py-16 space-y-3">
          <p className="text-slate-400 text-lg">No photos or media uploaded yet.</p>
          <p className="text-sm text-slate-400">
            Upload family photos, documents, and other media to enrich the memoir.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {items.map((item) => (
            <div
              key={item.id}
              onClick={() => { setSelectedItem(item); setEditingCaption(item.caption); }}
              className="group cursor-pointer bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm hover:shadow-md transition-shadow"
            >
              {isImage(item.mimeType) ? (
                <img
                  src={item.storageUrl}
                  alt={item.caption || item.filename}
                  className="w-full h-40 object-cover"
                />
              ) : (
                <div className="w-full h-40 bg-slate-50 flex items-center justify-center">
                  <span className="text-3xl">📄</span>
                </div>
              )}
              <div className="p-3">
                <p className="text-sm font-medium text-slate-800 truncate">
                  {item.caption || item.filename}
                </p>
                {item.date && (
                  <p className="text-xs text-slate-400 mt-0.5">{item.date}</p>
                )}
                {item.people.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {item.people.map((person) => (
                      <span key={person} className="text-[10px] font-medium bg-emerald-50 text-emerald-600 rounded-full px-2 py-0.5">
                        {person}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detail/lightbox modal */}
      {selectedItem && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-8">
          <div className="bg-white rounded-3xl max-w-3xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
            {isImage(selectedItem.mimeType) ? (
              <img
                src={selectedItem.storageUrl}
                alt={selectedItem.caption || selectedItem.filename}
                className="w-full max-h-[60vh] object-contain bg-slate-100 rounded-t-3xl"
              />
            ) : (
              <div className="w-full h-48 bg-slate-50 flex items-center justify-center rounded-t-3xl">
                <div className="text-center">
                  <span className="text-5xl block mb-2">📄</span>
                  <a
                    href={selectedItem.storageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-indigo-600 hover:underline"
                  >
                    Open file
                  </a>
                </div>
              </div>
            )}
            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Caption</label>
                <input
                  type="text"
                  value={editingCaption}
                  onChange={(e) => setEditingCaption(e.target.value)}
                  onBlur={handleSaveCaption}
                  className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div className="flex items-center gap-4 text-xs text-slate-400">
                <span>{selectedItem.filename}</span>
                <span>{(selectedItem.sizeBytes / 1024).toFixed(0)} KB</span>
                {selectedItem.date && <span>{selectedItem.date}</span>}
              </div>
              {selectedItem.people.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {selectedItem.people.map((person) => (
                    <span key={person} className="text-xs font-medium bg-emerald-50 text-emerald-600 rounded-full px-2.5 py-1">
                      {person}
                    </span>
                  ))}
                </div>
              )}
              <div className="flex justify-between pt-2">
                <button
                  onClick={() => handleDelete(selectedItem.id!)}
                  className="text-sm text-rose-600 font-medium hover:underline"
                >
                  Delete
                </button>
                <button
                  onClick={() => setSelectedItem(null)}
                  className="px-5 py-2 bg-slate-100 text-slate-700 rounded-xl text-sm font-semibold hover:bg-slate-200 transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
