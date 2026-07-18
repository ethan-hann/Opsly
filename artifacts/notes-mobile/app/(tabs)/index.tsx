import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import {
  useCreateNote,
  useDeleteNote,
  useListNotes,
} from '@workspace/api-client-react';

// ─── helpers ────────────────────────────────────────────────────────────────

function stripMarkdown(md: string): string {
  return md
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/^>\s+/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/\n+/g, ' ')
    .trim();
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

// ─── NoteCard ───────────────────────────────────────────────────────────────

interface NoteCardProps {
  id: number;
  title: string;
  content: string;
  updatedAt: string;
  projectId?: number | null;
  taskId?: number | null;
  onDelete: (id: number) => void;
}

function NoteCard({ id, title, content, updatedAt, projectId, taskId, onDelete }: NoteCardProps) {
  const colors = useColors();
  const preview = stripMarkdown(content).slice(0, 120);
  const hasLink = !!projectId || !!taskId;

  const handlePress = () => {
    Haptics.selectionAsync();
    router.push(`/note/${id}`);
  };

  const handleLongPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert('Delete note?', `"${title}" will be permanently deleted.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => onDelete(id),
      },
    ]);
  };

  const s = makeCardStyles(colors);

  return (
    <Pressable
      style={({ pressed }) => [s.card, pressed && s.cardPressed]}
      onPress={handlePress}
      onLongPress={handleLongPress}
    >
      <View style={s.cardTop}>
        <Text style={s.title} numberOfLines={1}>{title || 'Untitled'}</Text>
        <Text style={s.time}>{relativeTime(updatedAt)}</Text>
      </View>
      {preview.length > 0 && (
        <Text style={s.preview} numberOfLines={2}>{preview}</Text>
      )}
      {hasLink && (
        <View style={s.badge}>
          <Feather name="link" size={10} color={colors.primary} />
          <Text style={s.badgeText}>
            {projectId ? 'Project' : 'Task'}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

function makeCardStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 14,
      marginBottom: 10,
      gap: 6,
    },
    cardPressed: { opacity: 0.7 },
    cardTop: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 8,
    },
    title: {
      flex: 1,
      fontSize: 15,
      fontWeight: '600' as const,
      color: colors.foreground,
      fontFamily: 'Inter_600SemiBold',
    },
    time: {
      fontSize: 11,
      color: colors.mutedForeground,
      fontFamily: 'Inter_400Regular',
    },
    preview: {
      fontSize: 13,
      color: colors.mutedForeground,
      lineHeight: 18,
      fontFamily: 'Inter_400Regular',
    },
    badge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      alignSelf: 'flex-start',
      backgroundColor: colors.muted,
      borderRadius: 4,
      paddingHorizontal: 6,
      paddingVertical: 2,
    },
    badgeText: {
      fontSize: 10,
      color: colors.primary,
      fontFamily: 'Inter_500Medium',
    },
  });
}

// ─── EmptyState ──────────────────────────────────────────────────────────────

function EmptyState({ query, onCreate }: { query: string; onCreate: () => void }) {
  const colors = useColors();
  return (
    <View style={[emptyStyles.container]}>
      <Feather name="file-text" size={48} color={colors.mutedForeground} />
      <Text style={[emptyStyles.title, { color: colors.foreground }]}>
        {query ? 'No results' : 'No notes yet'}
      </Text>
      <Text style={[emptyStyles.sub, { color: colors.mutedForeground }]}>
        {query
          ? `Nothing matches "${query}"`
          : 'Tap + to write your first note'}
      </Text>
      {!query && (
        <Pressable
          style={[emptyStyles.btn, { backgroundColor: colors.primary }]}
          onPress={onCreate}
        >
          <Text style={[emptyStyles.btnText, { color: colors.primaryForeground }]}>
            New note
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const emptyStyles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 40,
    paddingBottom: 60,
  },
  title: { fontSize: 18, fontWeight: '600' as const, fontFamily: 'Inter_600SemiBold' },
  sub: { fontSize: 14, textAlign: 'center', fontFamily: 'Inter_400Regular' },
  btn: {
    marginTop: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  btnText: { fontSize: 15, fontWeight: '600' as const, fontFamily: 'Inter_600SemiBold' },
});

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function NotesListScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');

  const { data: notes = [], isLoading, isError, refetch } = useListNotes({});
  const createNote = useCreateNote();
  const deleteNote = useDeleteNote();

  const filtered = useMemo(() => {
    if (!query.trim()) return notes;
    const q = query.toLowerCase();
    return notes.filter(
      n =>
        n.title.toLowerCase().includes(q) ||
        n.content.toLowerCase().includes(q),
    );
  }, [notes, query]);

  const sorted = useMemo(
    () => [...filtered].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [filtered],
  );

  const handleCreate = useCallback(async () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const note = await createNote.mutateAsync({
        data: { title: 'Untitled', content: '' },
      });
      router.push(`/note/${note.id}`);
    } catch {
      Alert.alert('Error', 'Could not create note. Is the API server running?');
    }
  }, [createNote]);

  const handleDelete = useCallback(async (id: number) => {
    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      await deleteNote.mutateAsync({ id });
      refetch();
    } catch {
      Alert.alert('Error', 'Could not delete note.');
    }
  }, [deleteNote, refetch]);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const s = makeStyles(colors);

  return (
    <View style={[s.root, { paddingTop: topPad }]}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />

      {/* Header */}
      <View style={s.header}>
        <View>
          <Text style={s.headerEyebrow}>Mission Control</Text>
          <Text style={s.headerTitle}>Scratch Pad</Text>
        </View>
        <Pressable
          style={({ pressed }) => [s.addBtn, pressed && { opacity: 0.7 }]}
          onPress={handleCreate}
          disabled={createNote.isPending}
        >
          {createNote.isPending
            ? <ActivityIndicator size="small" color={colors.primaryForeground} />
            : <Feather name="plus" size={22} color={colors.primaryForeground} />
          }
        </Pressable>
      </View>

      {/* Search */}
      <View style={s.searchBar}>
        <Feather name="search" size={16} color={colors.mutedForeground} />
        <TextInput
          style={s.searchInput}
          placeholder="Search notes…"
          placeholderTextColor={colors.mutedForeground}
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
      </View>

      {/* List */}
      {isLoading ? (
        <View style={s.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : isError ? (
        <View style={s.center}>
          <Feather name="wifi-off" size={36} color={colors.mutedForeground} />
          <Text style={s.errorText}>Could not load notes</Text>
          <Pressable style={s.retryBtn} onPress={() => refetch()}>
            <Text style={[s.retryText, { color: colors.primary }]}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={sorted}
          keyExtractor={item => String(item.id)}
          renderItem={({ item }) => (
            <NoteCard
              id={item.id}
              title={item.title}
              content={item.content}
              updatedAt={item.updatedAt}
              projectId={item.projectId}
              taskId={item.taskId}
              onDelete={handleDelete}
            />
          )}
          contentContainerStyle={[
            s.list,
            sorted.length === 0 && { flex: 1 },
            { paddingBottom: bottomPad + 20 },
          ]}
          ListEmptyComponent={
            <EmptyState query={query} onCreate={handleCreate} />
          }
          refreshControl={
            <RefreshControl
              refreshing={isLoading}
              onRefresh={refetch}
              tintColor={colors.primary}
            />
          }
          showsVerticalScrollIndicator={false}
        />
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
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingTop: 12,
      paddingBottom: 4,
    },
    headerEyebrow: {
      fontSize: 11,
      fontWeight: '500' as const,
      color: colors.primary,
      letterSpacing: 1,
      textTransform: 'uppercase',
      fontFamily: 'Inter_500Medium',
    },
    headerTitle: {
      fontSize: 26,
      fontWeight: '700' as const,
      color: colors.foreground,
      fontFamily: 'Inter_700Bold',
    },
    addBtn: {
      width: 42,
      height: 42,
      borderRadius: 21,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    searchBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: colors.radius,
      marginHorizontal: 20,
      marginTop: 12,
      marginBottom: 14,
      paddingHorizontal: 12,
      paddingVertical: 9,
    },
    searchInput: {
      flex: 1,
      fontSize: 14,
      color: colors.foreground,
      fontFamily: 'Inter_400Regular',
    },
    list: {
      paddingHorizontal: 20,
    },
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
    },
    errorText: {
      fontSize: 15,
      color: colors.mutedForeground,
      fontFamily: 'Inter_400Regular',
    },
    retryBtn: { padding: 8 },
    retryText: {
      fontSize: 15,
      fontWeight: '600' as const,
      fontFamily: 'Inter_600SemiBold',
    },
  });
}
