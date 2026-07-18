import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import Markdown from 'react-native-markdown-display';
import { useColors } from '@/hooks/useColors';
import {
  useDeleteNote,
  useGetNote,
  useUpdateNote,
  NoteVisibility,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';

// ─── SegmentedControl ────────────────────────────────────────────────────────

type Mode = 'edit' | 'preview';

function SegmentedControl({
  value,
  onChange,
  colors,
}: {
  value: Mode;
  onChange: (v: Mode) => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={[seg.wrap, { backgroundColor: colors.muted, borderRadius: colors.radius }]}>
      {(['edit', 'preview'] as Mode[]).map(opt => (
        <Pressable
          key={opt}
          style={[
            seg.tab,
            { borderRadius: colors.radius - 2 },
            value === opt && { backgroundColor: colors.card },
          ]}
          onPress={() => {
            Haptics.selectionAsync();
            onChange(opt);
          }}
        >
          <Text
            style={[
              seg.label,
              { color: value === opt ? colors.foreground : colors.mutedForeground },
            ]}
          >
            {opt === 'edit' ? 'Edit' : 'Preview'}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const seg = StyleSheet.create({
  wrap: { flexDirection: 'row', padding: 3 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 6 },
  label: { fontSize: 13, fontWeight: '600' as const, fontFamily: 'Inter_600SemiBold' },
});

// ─── VisibilityToggle ─────────────────────────────────────────────────────────

const VISIBILITY_OPTIONS: { value: NoteVisibility; label: string; icon: string }[] = [
  { value: 'private', label: 'Private', icon: 'lock' },
  { value: 'public_read', label: 'Shared (read)', icon: 'eye' },
  { value: 'public_write', label: 'Shared (edit)', icon: 'edit-2' },
];

function VisibilityToggle({
  value,
  onChange,
  colors,
}: {
  value: NoteVisibility;
  onChange: (v: NoteVisibility) => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={[vis.wrap, { backgroundColor: colors.muted, borderRadius: colors.radius }]}>
      {VISIBILITY_OPTIONS.map(opt => {
        const active = value === opt.value;
        return (
          <Pressable
            key={opt.value}
            style={[
              vis.tab,
              { borderRadius: colors.radius - 2 },
              active && { backgroundColor: colors.card },
            ]}
            onPress={() => {
              Haptics.selectionAsync();
              onChange(opt.value);
            }}
          >
            <Feather
              name={opt.icon as any}
              size={11}
              color={active ? colors.primary : colors.mutedForeground}
            />
            <Text
              style={[
                vis.label,
                { color: active ? colors.foreground : colors.mutedForeground },
              ]}
              numberOfLines={1}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const vis = StyleSheet.create({
  wrap: { flexDirection: 'row', padding: 3 },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 4 },
  label: { fontSize: 11, fontWeight: '600' as const, fontFamily: 'Inter_600SemiBold' },
});

// ─── SaveIndicator ───────────────────────────────────────────────────────────

function SaveIndicator({
  status,
  colors,
}: {
  status: 'idle' | 'saving' | 'saved' | 'error';
  colors: ReturnType<typeof useColors>;
}) {
  if (status === 'idle') return null;
  return (
    <View style={saveInd.row}>
      {status === 'saving' && (
        <ActivityIndicator size="small" color={colors.mutedForeground} />
      )}
      {status === 'saved' && (
        <Feather name="check" size={14} color={colors.primary} />
      )}
      {status === 'error' && (
        <Feather name="alert-circle" size={14} color={colors.destructive} />
      )}
      <Text
        style={[
          saveInd.text,
          {
            color:
              status === 'saved'
                ? colors.primary
                : status === 'error'
                  ? colors.destructive
                  : colors.mutedForeground,
          },
        ]}
      >
        {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : 'Error'}
      </Text>
    </View>
  );
}

const saveInd = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  text: { fontSize: 12, fontFamily: 'Inter_400Regular' },
});

// ─── MarkdownStyles ───────────────────────────────────────────────────────────

function makeMarkdownStyles(colors: ReturnType<typeof useColors>) {
  return {
    body: {
      color: colors.foreground,
      fontFamily: 'Inter_400Regular',
      fontSize: 15,
      lineHeight: 24,
    },
    heading1: {
      color: colors.foreground,
      fontFamily: 'Inter_700Bold',
      fontSize: 24,
      marginTop: 16,
      marginBottom: 8,
      fontWeight: '700' as const,
    },
    heading2: {
      color: colors.foreground,
      fontFamily: 'Inter_700Bold',
      fontSize: 20,
      marginTop: 14,
      marginBottom: 6,
      fontWeight: '700' as const,
    },
    heading3: {
      color: colors.foreground,
      fontFamily: 'Inter_600SemiBold',
      fontSize: 17,
      marginTop: 12,
      marginBottom: 4,
      fontWeight: '600' as const,
    },
    paragraph: {
      color: colors.foreground,
      fontFamily: 'Inter_400Regular',
      fontSize: 15,
      lineHeight: 24,
      marginBottom: 8,
    },
    strong: { fontFamily: 'Inter_700Bold', fontWeight: '700' as const },
    em: { fontStyle: 'italic' as const },
    code_inline: {
      backgroundColor: colors.muted,
      color: colors.primary,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 13,
      borderRadius: 4,
      paddingHorizontal: 4,
    },
    fence: {
      backgroundColor: colors.muted,
      borderRadius: colors.radius,
      padding: 12,
      marginBottom: 12,
    },
    code_block: {
      backgroundColor: colors.muted,
      color: colors.foreground,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 13,
      borderRadius: colors.radius,
      padding: 12,
    },
    blockquote: {
      borderLeftWidth: 3,
      borderLeftColor: colors.primary,
      paddingLeft: 12,
      marginLeft: 0,
      marginBottom: 8,
    },
    bullet_list_icon: { color: colors.primary, marginTop: 6 },
    ordered_list_icon: { color: colors.primary, marginTop: 6 },
    link: { color: colors.primary },
    hr: { backgroundColor: colors.border, height: 1, marginVertical: 16 },
  };
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function NoteEditorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const noteId = Number(id);
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [mode, setMode] = useState<Mode>('edit');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [visibility, setVisibility] = useState<NoteVisibility>('private');
  const [isOwner, setIsOwner] = useState(true);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [initialised, setInitialised] = useState(false);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: note, isLoading } = useGetNote(noteId);
  const updateNote = useUpdateNote();
  const deleteNote = useDeleteNote();

  // Initialise local state from server once
  useEffect(() => {
    if (note && !initialised) {
      setTitle(note.title);
      setContent(note.content);
      setVisibility(note.visibility);
      setIsOwner(note.isOwner);
      setInitialised(true);
    }
  }, [note, initialised]);

  // Whether the current user can edit this note's content
  const canEdit = isOwner || visibility === 'public_write';

  // ── Auto-save (title + content) ────────────────────────────────────────────
  const save = useCallback(
    async (t: string, c: string) => {
      setSaveStatus('saving');
      try {
        await updateNote.mutateAsync({ id: noteId, data: { title: t, content: c } });
        setSaveStatus('saved');
        queryClient.invalidateQueries({ queryKey: ['/api/notes'] });
        setTimeout(() => setSaveStatus('idle'), 1500);
      } catch {
        setSaveStatus('error');
      }
    },
    [noteId, updateNote, queryClient],
  );

  const scheduleAutosave = useCallback(
    (t: string, c: string) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => save(t, c), 800);
    },
    [save],
  );

  const handleTitleChange = (v: string) => {
    setTitle(v);
    scheduleAutosave(v, content);
  };

  const handleContentChange = (v: string) => {
    setContent(v);
    scheduleAutosave(title, v);
  };

  // flush on unmount
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  // ── Visibility change (immediate, no debounce) ─────────────────────────────
  const handleVisibilityChange = useCallback(
    async (v: NoteVisibility) => {
      const prev = visibility;
      setVisibility(v);
      setSaveStatus('saving');
      try {
        await updateNote.mutateAsync({ id: noteId, data: { visibility: v } });
        setSaveStatus('saved');
        queryClient.invalidateQueries({ queryKey: ['/api/notes'] });
        setTimeout(() => setSaveStatus('idle'), 1500);
      } catch {
        setVisibility(prev); // revert on failure
        setSaveStatus('error');
      }
    },
    [noteId, visibility, updateNote, queryClient],
  );

  // ── Delete ─────────────────────────────────────────────────────────────────
  const handleDelete = () => {
    Alert.alert(
      'Delete note?',
      `"${title || 'Untitled'}" will be permanently deleted.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
              await deleteNote.mutateAsync({ id: noteId });
              queryClient.invalidateQueries({ queryKey: ['/api/notes'] });
              router.back();
            } catch {
              Alert.alert('Error', 'Could not delete note.');
            }
          },
        },
      ],
    );
  };

  // ── Layout helpers ─────────────────────────────────────────────────────────
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const mdStyles = makeMarkdownStyles(colors);
  const s = makeStyles(colors);

  // ── Render ─────────────────────────────────────────────────────────────────
  if (isLoading && !initialised) {
    return (
      <View style={[s.root, s.center, { paddingTop: topPad }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[s.root, { paddingTop: topPad, paddingBottom: bottomPad }]}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />

      {/* Top bar */}
      <View style={s.topBar}>
        <Pressable
          style={({ pressed }) => [s.iconBtn, pressed && { opacity: 0.6 }]}
          onPress={() => router.back()}
          hitSlop={8}
        >
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>

        <SaveIndicator status={saveStatus} colors={colors} />

        {isOwner && (
          <Pressable
            style={({ pressed }) => [s.iconBtn, pressed && { opacity: 0.6 }]}
            onPress={handleDelete}
            hitSlop={8}
          >
            <Feather name="trash-2" size={20} color={colors.destructive} />
          </Pressable>
        )}
        {!isOwner && <View style={s.iconBtn} />}
      </View>

      {/* Title input */}
      <TextInput
        style={[s.titleInput, !canEdit && { color: colors.mutedForeground }]}
        value={title}
        onChangeText={handleTitleChange}
        placeholder="Untitled"
        placeholderTextColor={colors.mutedForeground}
        multiline={false}
        returnKeyType="next"
        editable={canEdit}
      />

      {/* Visibility toggle — owner only */}
      {isOwner && (
        <View style={s.visibilityRow}>
          <VisibilityToggle value={visibility} onChange={handleVisibilityChange} colors={colors} />
        </View>
      )}

      {/* Read-only notice for non-owners viewing a shared read-only note */}
      {!isOwner && (
        <View style={[s.readOnlyBanner, { backgroundColor: colors.muted }]}>
          <Feather
            name={visibility === 'public_write' ? 'edit-2' : 'eye'}
            size={12}
            color={colors.mutedForeground}
          />
          <Text style={[s.readOnlyText, { color: colors.mutedForeground }]}>
            {visibility === 'public_write' ? 'Shared — you can edit this note' : 'Shared — read only'}
          </Text>
        </View>
      )}

      {/* Mode toggle */}
      <View style={s.toggleRow}>
        <SegmentedControl value={mode} onChange={setMode} colors={colors} />
      </View>

      {/* Content area */}
      {mode === 'edit' ? (
        <TextInput
          style={[s.editor, { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }]}
          value={content}
          onChangeText={handleContentChange}
          placeholder={canEdit ? 'Write in markdown…' : 'Nothing to read yet'}
          placeholderTextColor={colors.mutedForeground}
          multiline
          textAlignVertical="top"
          autoCorrect={false}
          autoCapitalize="sentences"
          scrollEnabled
          editable={canEdit}
        />
      ) : (
        <ScrollView
          style={s.previewScroll}
          contentContainerStyle={s.previewContent}
          showsVerticalScrollIndicator={false}
        >
          {content.trim() ? (
            <Markdown style={mdStyles}>{content}</Markdown>
          ) : (
            <View style={s.emptyPreview}>
              <Feather name="eye-off" size={28} color={colors.mutedForeground} />
              <Text style={[s.emptyPreviewText, { color: colors.mutedForeground }]}>
                Nothing to preview yet
              </Text>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.background,
    },
    center: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    iconBtn: {
      width: 36,
      height: 36,
      alignItems: 'center',
      justifyContent: 'center',
    },
    titleInput: {
      fontSize: 22,
      fontWeight: '700' as const,
      fontFamily: 'Inter_700Bold',
      color: colors.foreground,
      paddingHorizontal: 20,
      paddingVertical: 8,
    },
    visibilityRow: {
      paddingHorizontal: 20,
      marginBottom: 8,
    },
    readOnlyBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginHorizontal: 20,
      marginBottom: 8,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: colors.radius,
    },
    readOnlyText: {
      fontSize: 11,
      fontFamily: 'Inter_400Regular',
    },
    toggleRow: {
      paddingHorizontal: 20,
      marginBottom: 12,
    },
    editor: {
      flex: 1,
      fontSize: 14,
      lineHeight: 22,
      color: colors.foreground,
      paddingHorizontal: 20,
      paddingTop: 4,
      paddingBottom: 16,
    },
    previewScroll: {
      flex: 1,
    },
    previewContent: {
      paddingHorizontal: 20,
      paddingBottom: 40,
    },
    emptyPreview: {
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
      paddingTop: 60,
    },
    emptyPreviewText: {
      fontSize: 14,
      fontFamily: 'Inter_400Regular',
    },
  });
}
