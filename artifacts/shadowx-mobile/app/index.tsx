import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';

type GameMode = 'menu' | 'play' | 'upgrades' | 'settings' | 'complete' | 'dead';
type EnemyType = 'basic' | 'fast' | 'heavy' | 'ranged' | 'boss';
type UpgradeKey = 'attack' | 'health' | 'speed' | 'dash' | 'blast';

type Player = {
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  energy: number;
  maxEnergy: number;
  invulnerableUntil: number;
};

type Enemy = {
  id: string;
  type: EnemyType;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  speed: number;
  damage: number;
  radius: number;
  color: string;
  lastAttack: number;
  flashUntil: number;
};

type DamageNumber = {
  id: string;
  x: number;
  y: number;
  value: number;
  color: string;
  expiresAt: number;
};

type SaveData = {
  coins: number;
  highestLevel: number;
  attack: number;
  health: number;
  speed: number;
  dash: number;
  blast: number;
  muted: boolean;
};

type Runtime = {
  player: Player;
  enemies: Enemy[];
  floats: DamageNumber[];
  effect: { kind: 'slash' | 'blast'; x: number; y: number; expiresAt: number } | null;
};

const SAVE_KEY = 'shadowx-save-v1';
const DEFAULT_SAVE: SaveData = {
  coins: 0,
  highestLevel: 1,
  attack: 0,
  health: 0,
  speed: 0,
  dash: 0,
  blast: 0,
  muted: false,
};

type StarPosition = { left: `${number}%`; top: `${number}%`; size: number };

const STAR_POSITIONS: StarPosition[] = [
  { left: '12%', top: '18%', size: 2 },
  { left: '26%', top: '11%', size: 1 },
  { left: '48%', top: '23%', size: 2 },
  { left: '69%', top: '14%', size: 1 },
  { left: '83%', top: '30%', size: 2 },
  { left: '91%', top: '61%', size: 1 },
  { left: '8%', top: '68%', size: 1 },
  { left: '36%', top: '78%', size: 2 },
  { left: '62%', top: '83%', size: 1 },
];

const ENEMY_META: Record<
  EnemyType,
  { label: string; color: string; hp: number; speed: number; damage: number; radius: number }
> = {
  basic: { label: 'BASIC', color: '#8d8bff', hp: 42, speed: 42, damage: 8, radius: 17 },
  fast: { label: 'FAST', color: '#65e6e5', hp: 26, speed: 72, damage: 6, radius: 13 },
  heavy: { label: 'HEAVY', color: '#ff8fbc', hp: 90, speed: 25, damage: 15, radius: 23 },
  ranged: { label: 'RANGED', color: '#ffc857', hp: 36, speed: 30, damage: 10, radius: 15 },
  boss: { label: 'BOSS', color: '#ff5370', hp: 440, speed: 19, damage: 27, radius: 34 },
};

const UPGRADE_META: Array<{ key: UpgradeKey; label: string; detail: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { key: 'attack', label: 'Attack Damage', detail: 'Heavier shadow sword strikes', icon: 'flash-outline' },
  { key: 'health', label: 'Maximum Health', detail: 'More room to survive the swarm', icon: 'heart-outline' },
  { key: 'speed', label: 'Movement Speed', detail: 'Slip through danger faster', icon: 'navigate-outline' },
  { key: 'dash', label: 'Dash Cooldown', detail: 'Escape pressure more often', icon: 'chevron-forward-circle-outline' },
  { key: 'blast', label: 'Shadow Blast', detail: 'Widen the energy burst damage', icon: 'radio-outline' },
];

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function upgradeCost(level: number) {
  return 45 + level * 35;
}

function newId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function triggerHaptic(kind: 'light' | 'medium' | 'heavy' = 'light') {
  if (Platform.OS === 'web') return;
  const style =
    kind === 'heavy'
      ? Haptics.ImpactFeedbackStyle.Heavy
      : kind === 'medium'
        ? Haptics.ImpactFeedbackStyle.Medium
        : Haptics.ImpactFeedbackStyle.Light;
  void Haptics.impactAsync(style);
}

function makePlayer(width: number, height: number, save: SaveData): Player {
  const maxHp = 100 + save.health * 20;
  return {
    x: width / 2,
    y: height / 2,
    hp: maxHp,
    maxHp,
    energy: 100,
    maxEnergy: 100,
    invulnerableUntil: 0,
  };
}

function spawnEnemies(level: number, width: number, height: number, save: SaveData, colors: ReturnType<typeof useColors>) {
  const count = Math.min(11, 3 + level);
  const difficulty = 1 + (level - 1) * 0.16;
  const enemies: Enemy[] = [];
  const types: EnemyType[] = ['basic', 'fast', 'heavy', 'ranged'];
  const bossLevel = level % 5 === 0;

  for (let index = 0; index < count; index += 1) {
    const type = types[(index + level) % types.length];
    const meta = ENEMY_META[type];
    const edge = index % 4;
    const x = edge === 0 ? 38 : edge === 1 ? width - 38 : 48 + ((index * 91) % Math.max(80, width - 96));
    const y = edge === 2 ? 34 : edge === 3 ? height - 34 : 42 + ((index * 57) % Math.max(100, height - 84));
    const maxHp = Math.round(meta.hp * difficulty);
    enemies.push({
      id: newId('enemy'),
      type,
      x,
      y,
      hp: maxHp,
      maxHp,
      speed: meta.speed * (1 + save.speed * 0.025) * (1 + (level - 1) * 0.04),
      damage: Math.round(meta.damage * difficulty),
      radius: meta.radius,
      color:
        type === 'basic'
          ? colors.violet
          : type === 'fast'
            ? colors.cyan
            : type === 'heavy'
              ? '#ff8fbc'
              : colors.gold,
      lastAttack: 0,
      flashUntil: 0,
    });
  }

  if (bossLevel) {
    const meta = ENEMY_META.boss;
    const maxHp = Math.round(meta.hp * (1 + (level / 5 - 1) * 0.25));
    enemies.push({
      id: newId('boss'),
      type: 'boss',
      x: width - 56,
      y: height / 2,
      hp: maxHp,
      maxHp,
      speed: meta.speed * (1 + (level - 1) * 0.02),
      damage: Math.round(meta.damage * difficulty),
      radius: meta.radius,
      color: colors.destructive,
      lastAttack: 0,
      flashUntil: 0,
    });
  }
  return enemies;
}

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <View style={styles.barTrack}>
      <View style={[styles.barFill, { width: `${clamp((value / max) * 100, 0, 100)}%`, backgroundColor: color }]} />
    </View>
  );
}

function ActionButton({
  icon,
  label,
  onPress,
  disabled,
  accent,
  testID,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  accent: string;
  testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.actionButton,
        { borderColor: accent, opacity: disabled ? 0.34 : pressed ? 0.66 : 1 },
      ]}
    >
      <MaterialCommunityIcons name={icon} size={28} color={accent} />
      <Text style={[styles.actionLabel, { color: accent }]}>{label}</Text>
    </Pressable>
  );
}

export default function ShadowXScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const topInset = Platform.OS === 'web' ? Math.max(insets.top, 67) : insets.top;
  const bottomInset = Platform.OS === 'web' ? 34 : insets.bottom;
  const arenaWidth = Math.max(300, screenWidth);
  const arenaHeight = Math.max(430, screenHeight - topInset - bottomInset - 72);

  const [mode, setMode] = useState<GameMode>('menu');
  const [save, setSave] = useState<SaveData>(DEFAULT_SAVE);
  const [player, setPlayer] = useState<Player>(() => makePlayer(arenaWidth, arenaHeight, DEFAULT_SAVE));
  const [enemies, setEnemies] = useState<Enemy[]>([]);
  const [damageNumbers, setDamageNumbers] = useState<DamageNumber[]>([]);
  const [paused, setPaused] = useState(false);
  const [level, setLevel] = useState(1);
  const [flash, setFlash] = useState(false);

  const saveRef = useRef(save);
  const runtimeRef = useRef<Runtime>({
    player,
    enemies: [],
    floats: [],
    effect: null,
  });
  const joystickRef = useRef({ x: 0, y: 0 });
  const keyboardRef = useRef({ x: 0, y: 0 });
  const lastDirectionRef = useRef({ x: 0, y: -1 });
  const joystickOriginRef = useRef({ x: 0, y: 0 });
  const attackCooldownRef = useRef(0);
  const dashCooldownRef = useRef(0);
  const lastTickRef = useRef(Date.now());
  const completionLockRef = useRef(false);

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  useEffect(() => {
    void AsyncStorage.getItem(SAVE_KEY).then((raw) => {
      if (!raw) return;
      try {
        const loaded = JSON.parse(raw) as Partial<SaveData>;
        const next = { ...DEFAULT_SAVE, ...loaded };
        setSave(next);
        saveRef.current = next;
      } catch {
        // A malformed local save should not prevent the game from opening.
      }
    });
  }, []);

  const persistSave = (next: SaveData) => {
    saveRef.current = next;
    setSave(next);
    void AsyncStorage.setItem(SAVE_KEY, JSON.stringify(next));
  };

  const updateSave = (updater: (current: SaveData) => SaveData) => {
    persistSave(updater(saveRef.current));
  };

  const addFloat = (x: number, y: number, value: number, color: string) => {
    const item: DamageNumber = {
      id: newId('float'),
      x,
      y,
      value,
      color,
      expiresAt: Date.now() + 780,
    };
    runtimeRef.current.floats = [...runtimeRef.current.floats, item];
  };

  const startLevel = (nextLevel: number) => {
    const nextPlayer = makePlayer(arenaWidth, arenaHeight, saveRef.current);
    const nextEnemies = spawnEnemies(nextLevel, arenaWidth, arenaHeight, saveRef.current, colors);
    runtimeRef.current = { player: nextPlayer, enemies: nextEnemies, floats: [], effect: null };
    setPlayer(nextPlayer);
    setEnemies(nextEnemies);
    setDamageNumbers([]);
    setLevel(nextLevel);
    setPaused(false);
    completionLockRef.current = false;
    lastTickRef.current = Date.now();
    setMode('play');
    triggerHaptic('medium');
  };

  const completeLevel = () => {
    if (completionLockRef.current) return;
    completionLockRef.current = true;
    const reward = 25 + level * 12;
    updateSave((current) => ({
      ...current,
      coins: current.coins + reward,
      highestLevel: Math.max(current.highestLevel, level + 1),
    }));
    triggerHaptic('heavy');
    setMode('complete');
  };

  const performAttack = () => {
    if (mode !== 'play' || paused || Date.now() < attackCooldownRef.current) return;
    attackCooldownRef.current = Date.now() + 360;
    const runtime = runtimeRef.current;
    const target = runtime.enemies
      .map((enemy) => ({ enemy, distance: distance(runtime.player, enemy) }))
      .filter((item) => item.distance < 108)
      .sort((a, b) => a.distance - b.distance)[0]?.enemy;
    runtime.effect = {
      kind: 'slash',
      x: runtime.player.x,
      y: runtime.player.y,
      expiresAt: Date.now() + 180,
    };
    if (!target) {
      triggerHaptic('light');
      return;
    }
    const damage = 24 + saveRef.current.attack * 7;
    const updated = runtime.enemies.map((enemy) =>
      enemy.id === target.id ? { ...enemy, hp: enemy.hp - damage, flashUntil: Date.now() + 140 } : enemy,
    );
    runtime.enemies = updated.filter((enemy) => enemy.hp > 0);
    addFloat(target.x, target.y - target.radius - 9, damage, colors.cyan);
    if (runtime.enemies.length < updated.length) {
      const coinReward = target.type === 'boss' ? 100 : target.type === 'heavy' ? 18 : 10;
      updateSave((current) => ({ ...current, coins: current.coins + coinReward }));
      addFloat(target.x, target.y - target.radius - 30, coinReward, colors.gold);
    }
    setEnemies(runtime.enemies);
    setDamageNumbers([...runtime.floats]);
    if (runtime.enemies.length === 0) completeLevel();
    triggerHaptic('light');
  };

  const performDash = () => {
    if (mode !== 'play' || paused || Date.now() < dashCooldownRef.current) return;
    dashCooldownRef.current = Date.now() + Math.max(620, 1450 - saveRef.current.dash * 150);
    const runtime = runtimeRef.current;
    const direction = lastDirectionRef.current;
    runtime.player = {
      ...runtime.player,
      x: clamp(runtime.player.x + direction.x * 92, 24, arenaWidth - 24),
      y: clamp(runtime.player.y + direction.y * 92, 24, arenaHeight - 24),
      invulnerableUntil: Date.now() + 360,
    };
    setPlayer(runtime.player);
    runtime.effect = {
      kind: 'slash',
      x: runtime.player.x,
      y: runtime.player.y,
      expiresAt: Date.now() + 230,
    };
    triggerHaptic('medium');
  };

  const performBlast = () => {
    if (mode !== 'play' || paused || runtimeRef.current.player.energy < 50) return;
    const runtime = runtimeRef.current;
    runtime.player = { ...runtime.player, energy: runtime.player.energy - 50 };
    const damage = 58 + saveRef.current.blast * 13;
    const inRange = runtime.enemies.filter((enemy) => distance(runtime.player, enemy) < 168);
    runtime.enemies = runtime.enemies
      .map((enemy) =>
        distance(runtime.player, enemy) < 168
          ? { ...enemy, hp: enemy.hp - damage, flashUntil: Date.now() + 230 }
          : enemy,
      )
      .filter((enemy) => enemy.hp > 0);
    inRange.forEach((enemy) => addFloat(enemy.x, enemy.y - enemy.radius - 10, damage, colors.violet));
    inRange.forEach((enemy) => {
      if (enemy.hp <= damage) {
        updateSave((current) => ({
          ...current,
          coins: current.coins + (enemy.type === 'boss' ? 100 : 10),
        }));
      }
    });
    runtime.effect = {
      kind: 'blast',
      x: runtime.player.x,
      y: runtime.player.y,
      expiresAt: Date.now() + 380,
    };
    setPlayer(runtime.player);
    setEnemies(runtime.enemies);
    setDamageNumbers([...runtime.floats]);
    setFlash(true);
    setTimeout(() => setFlash(false), 160);
    if (runtime.enemies.length === 0) completeLevel();
    triggerHaptic('heavy');
  };

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const next = { ...keyboardRef.current };
      if (key === 'arrowleft' || key === 'a') next.x = -1;
      if (key === 'arrowright' || key === 'd') next.x = 1;
      if (key === 'arrowup' || key === 'w') next.y = -1;
      if (key === 'arrowdown' || key === 's') next.y = 1;
      keyboardRef.current = next;
      if (key === ' ' || key === 'j') performAttack();
      if (key === 'shift') performDash();
      if (key === 'e') performBlast();
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const next = { ...keyboardRef.current };
      if (key === 'arrowleft' || key === 'a' || key === 'arrowright' || key === 'd') next.x = 0;
      if (key === 'arrowup' || key === 'w' || key === 'arrowdown' || key === 's') next.y = 0;
      keyboardRef.current = next;
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  });

  useEffect(() => {
    if (mode !== 'play' || paused) return;
    const interval = setInterval(() => {
      const now = Date.now();
      const dt = clamp((now - lastTickRef.current) / 1000, 0.01, 0.08);
      lastTickRef.current = now;
      const runtime = runtimeRef.current;
      const p = { ...runtime.player };
      const input = joystickRef.current;
      const keyboard = keyboardRef.current;
      const moveX = Math.abs(input.x) > 0.08 ? input.x : keyboard.x;
      const moveY = Math.abs(input.y) > 0.08 ? input.y : keyboard.y;
      const magnitude = Math.sqrt(moveX * moveX + moveY * moveY);
      if (magnitude > 0.08) {
        const normalX = moveX / Math.max(1, magnitude);
        const normalY = moveY / Math.max(1, magnitude);
        lastDirectionRef.current = { x: normalX, y: normalY };
        const speed = 132 + saveRef.current.speed * 14;
        p.x = clamp(p.x + normalX * speed * dt, 24, arenaWidth - 24);
        p.y = clamp(p.y + normalY * speed * dt, 24, arenaHeight - 24);
      }
      p.energy = Math.min(p.maxEnergy, p.energy + dt * 13);

      let incomingDamage = 0;
      const updatedEnemies = runtime.enemies.map((enemy) => {
        const current = { ...enemy };
        const dx = p.x - current.x;
        const dy = p.y - current.y;
        const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const isRanged = current.type === 'ranged';
        const desiredDistance = isRanged ? 146 : current.radius + 28;
        if (dist > desiredDistance) {
          current.x += (dx / dist) * current.speed * dt;
          current.y += (dy / dist) * current.speed * dt;
        }
        const inAttackRange = isRanged ? dist < 220 : dist < desiredDistance + 12;
        if (inAttackRange && now - current.lastAttack > (current.type === 'boss' ? 730 : 920)) {
          current.lastAttack = now;
          if (now > p.invulnerableUntil) incomingDamage += current.damage;
        }
        current.flashUntil = Math.max(0, current.flashUntil - 0);
        return current;
      });

      if (incomingDamage > 0 && now > p.invulnerableUntil) {
        p.hp = Math.max(0, p.hp - incomingDamage);
        p.invulnerableUntil = now + 180;
        addFloat(p.x, p.y - 26, incomingDamage, colors.destructive);
        triggerHaptic('light');
      }

      runtime.player = p;
      runtime.enemies = updatedEnemies;
      runtime.floats = runtime.floats.filter((item) => item.expiresAt > now);
      runtime.effect = runtime.effect && runtime.effect.expiresAt > now ? runtime.effect : null;
      setPlayer(p);
      setEnemies(updatedEnemies);
      setDamageNumbers([...runtime.floats]);
      if (p.hp <= 0) {
        setMode('dead');
        triggerHaptic('heavy');
      } else if (updatedEnemies.length === 0) {
        completeLevel();
      }
    }, 50);
    return () => clearInterval(interval);
  }, [arenaHeight, arenaWidth, colors, mode, paused]);

  const joystickResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => {
          joystickOriginRef.current = {
            x: event.nativeEvent.pageX,
            y: event.nativeEvent.pageY,
          };
        },
        onPanResponderMove: (event) => {
          const dx = event.nativeEvent.pageX - joystickOriginRef.current.x;
          const dy = event.nativeEvent.pageY - joystickOriginRef.current.y;
          const magnitude = Math.max(1, Math.sqrt(dx * dx + dy * dy));
          joystickRef.current = {
            x: clamp(dx / Math.max(54, magnitude), -1, 1),
            y: clamp(dy / Math.max(54, magnitude), -1, 1),
          };
        },
        onPanResponderRelease: () => {
          joystickRef.current = { x: 0, y: 0 };
        },
        onPanResponderTerminate: () => {
          joystickRef.current = { x: 0, y: 0 };
        },
      }),
    [],
  );

  const openMenu = () => {
    setPaused(false);
    setMode('menu');
  };

  const purchaseUpgrade = (key: UpgradeKey) => {
    const current = saveRef.current;
    const cost = upgradeCost(current[key]);
    if (current.coins < cost) {
      triggerHaptic('light');
      return;
    }
    updateSave((data) => ({ ...data, coins: data.coins - cost, [key]: data[key] + 1 }));
    triggerHaptic('medium');
  };

  const renderHeader = (title: string, eyebrow: string) => (
    <View style={[styles.pageHeader, { paddingTop: topInset + 14 }]}>
      <Pressable testID="back-button" onPress={openMenu} style={styles.iconButton}>
        <Feather name="arrow-left" size={20} color={colors.foreground} />
      </Pressable>
      <View>
        <Text style={styles.eyebrow}>{eyebrow}</Text>
        <Text style={styles.pageTitle}>{title}</Text>
      </View>
    </View>
  );

  if (mode === 'menu') {
    return (
      <LinearGradient colors={[colors.background, '#10102b', colors.background]} style={styles.screen}>
        <View style={styles.starsLayer} pointerEvents="none">
          {STAR_POSITIONS.map((star, index) => (
            <View
              key={`star-${index}`}
              style={[
                styles.star,
                {
                  left: star.left,
                  top: star.top,
                  width: star.size,
                  height: star.size,
                  backgroundColor: index % 2 ? colors.violet : colors.cyan,
                },
              ]}
            />
          ))}
        </View>
        <View style={[styles.menuContent, { paddingTop: topInset + 44, paddingBottom: bottomInset + 18 }]}>
          <View style={styles.logoLockup}>
            <View style={[styles.logoMark, { borderColor: colors.cyan }]}>
              <View style={[styles.logoEye, { backgroundColor: colors.cyan }]} />
              <View style={[styles.logoEye, { backgroundColor: colors.violet }]} />
            </View>
            <Text style={styles.logoText}>SHADOW<Text style={{ color: colors.cyan }}>X</Text></Text>
            <Text style={styles.logoSubline}>THE VOID ANSWERS TO NO ONE</Text>
          </View>
          <View style={styles.menuIntro}>
            <Text style={styles.menuKicker}>NIGHTFALL PROTOCOL // ONLINE</Text>
            <Text style={styles.menuHeadline}>Become the last light in the dark.</Text>
            <Text style={styles.menuBody}>Cut through the swarm. Survive the arena. Grow stronger with every level.</Text>
          </View>
          <View style={styles.menuActions}>
            <Pressable
              testID="play-button"
              accessibilityRole="button"
              onPress={() => startLevel(Math.max(1, save.highestLevel))}
              style={({ pressed }) => [styles.primaryButton, { backgroundColor: colors.cyan, opacity: pressed ? 0.78 : 1 }]}
            >
              <Ionicons name="play" size={18} color={colors.primaryForeground} />
              <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>ENTER THE VOID</Text>
            </Pressable>
            <View style={styles.secondaryActionRow}>
              <Pressable testID="upgrades-button" onPress={() => setMode('upgrades')} style={styles.secondaryButton}>
                <Ionicons name="sparkles-outline" size={18} color={colors.violet} />
                <Text style={styles.secondaryButtonText}>UPGRADES</Text>
              </Pressable>
              <Pressable testID="settings-button" onPress={() => setMode('settings')} style={styles.secondaryButton}>
                <Ionicons name="settings-outline" size={18} color={colors.violet} />
                <Text style={styles.secondaryButtonText}>SETTINGS</Text>
              </Pressable>
            </View>
          </View>
          <View style={styles.menuFooter}>
            <View>
              <Text style={styles.statLabel}>CURRENT RUN</Text>
              <Text style={styles.statValue}>LEVEL {save.highestLevel}</Text>
            </View>
            <View style={styles.coinPill}>
              <Ionicons name="ellipse" size={12} color={colors.gold} />
              <Text style={[styles.coinText, { color: colors.gold }]}>{save.coins}</Text>
            </View>
          </View>
        </View>
      </LinearGradient>
    );
  }

  if (mode === 'upgrades') {
    return (
      <LinearGradient colors={[colors.background, '#10102b', colors.background]} style={styles.screen}>
        {renderHeader('Upgrade Lab', 'SHADOWX // LOADOUT')}
        <View style={[styles.panelContent, { paddingBottom: bottomInset + 20 }]}>
          <View style={styles.currencyBanner}>
            <View>
              <Text style={styles.eyebrow}>AVAILABLE CREDITS</Text>
              <Text style={[styles.currencyValue, { color: colors.gold }]}>{save.coins}</Text>
            </View>
            <Ionicons name="ellipse" size={22} color={colors.gold} />
          </View>
          {UPGRADE_META.map((item) => {
            const currentLevel = save[item.key];
            const cost = upgradeCost(currentLevel);
            const affordable = save.coins >= cost;
            return (
              <View key={item.key} style={styles.upgradeRow}>
                <View style={[styles.upgradeIcon, { backgroundColor: colors.muted }]}>
                  <Ionicons name={item.icon} size={20} color={colors.cyan} />
                </View>
                <View style={styles.upgradeCopy}>
                  <Text style={styles.upgradeLabel}>{item.label}</Text>
                  <Text style={styles.upgradeDetail}>{item.detail}</Text>
                  <View style={styles.levelDots}>
                    {[0, 1, 2, 3, 4].map((dot) => (
                      <View key={dot} style={[styles.levelDot, { backgroundColor: dot < currentLevel ? colors.violet : colors.border }]} />
                    ))}
                  </View>
                </View>
                <Pressable
                  testID={`upgrade-${item.key}`}
                  onPress={() => purchaseUpgrade(item.key)}
                  style={({ pressed }) => [
                    styles.buyButton,
                    { borderColor: affordable ? colors.cyan : colors.border, opacity: pressed ? 0.65 : affordable ? 1 : 0.45 },
                  ]}
                >
                  <Text style={[styles.buyPrice, { color: affordable ? colors.cyan : colors.mutedForeground }]}>{cost}</Text>
                  <Ionicons name="ellipse" size={9} color={affordable ? colors.gold : colors.mutedForeground} />
                  <Ionicons name="add" size={16} color={affordable ? colors.cyan : colors.mutedForeground} />
                </Pressable>
              </View>
            );
          })}
        </View>
      </LinearGradient>
    );
  }

  if (mode === 'settings') {
    return (
      <LinearGradient colors={[colors.background, '#10102b', colors.background]} style={styles.screen}>
        {renderHeader('Settings', 'SHADOWX // SYSTEM')}
        <View style={[styles.panelContent, { paddingBottom: bottomInset + 20 }]}>
          <View style={styles.settingsCard}>
            <View style={styles.settingCopy}>
              <Text style={styles.upgradeLabel}>Audio feedback</Text>
              <Text style={styles.upgradeDetail}>Toggle music and combat sound cues</Text>
            </View>
            <Pressable
              testID="mute-toggle"
              accessibilityRole="switch"
              accessibilityState={{ checked: !save.muted }}
              onPress={() => updateSave((current) => ({ ...current, muted: !current.muted }))}
              style={[styles.toggle, { backgroundColor: save.muted ? colors.muted : colors.cyan }]}
            >
              <View style={[styles.toggleThumb, { backgroundColor: save.muted ? colors.mutedForeground : colors.primaryForeground, alignSelf: save.muted ? 'flex-start' : 'flex-end' }]} />
            </Pressable>
          </View>
          <View style={styles.settingsCard}>
            <View style={styles.settingCopy}>
              <Text style={styles.upgradeLabel}>Controls</Text>
              <Text style={styles.upgradeDetail}>Touch: joystick + action buttons{'\n'}Browser: WASD / arrows, Space, Shift, E</Text>
            </View>
            <Ionicons name="game-controller-outline" size={26} color={colors.violet} />
          </View>
          <View style={styles.settingsCard}>
            <View style={styles.settingCopy}>
              <Text style={styles.upgradeLabel}>Progress</Text>
              <Text style={styles.upgradeDetail}>Local save is enabled on this device.</Text>
            </View>
            <Ionicons name="shield-checkmark-outline" size={26} color={colors.success} />
          </View>
        </View>
      </LinearGradient>
    );
  }

  const isPlaying = mode === 'play';
  const dashReady = Date.now() >= dashCooldownRef.current;
  const blastReady = player.energy >= 50;
  const activeEffect = runtimeRef.current.effect;

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.gameShell, { paddingTop: topInset, paddingBottom: bottomInset }]}>
        <View style={styles.hud}>
          <View style={styles.hudLeft}>
            <View style={styles.hudBrand}>
              <View style={[styles.tinyMark, { borderColor: colors.cyan }]} />
              <Text style={styles.hudBrandText}>SHADOWX</Text>
            </View>
            <View style={styles.barGroup}>
              <View style={styles.barLabelRow}>
                <Text style={styles.barLabel}>VITALITY</Text>
                <Text style={[styles.barValue, { color: colors.destructive }]}>{Math.ceil(player.hp)} / {player.maxHp}</Text>
              </View>
              <Bar value={player.hp} max={player.maxHp} color={colors.destructive} />
              <View style={styles.barLabelRow}>
                <Text style={styles.barLabel}>ENERGY</Text>
                <Text style={[styles.barValue, { color: colors.cyan }]}>{Math.ceil(player.energy)}%</Text>
              </View>
              <Bar value={player.energy} max={player.maxEnergy} color={colors.cyan} />
            </View>
          </View>
          <View style={styles.hudRight}>
            <View style={styles.levelChip}>
              <Text style={styles.chipLabel}>LEVEL</Text>
              <Text style={[styles.chipValue, { color: colors.cyan }]}>{level}</Text>
            </View>
            <View style={styles.coinPill}>
              <Ionicons name="ellipse" size={11} color={colors.gold} />
              <Text style={[styles.coinText, { color: colors.gold }]}>{save.coins}</Text>
            </View>
            <Pressable testID="pause-button" onPress={() => setPaused((value) => !value)} style={styles.iconButton}>
              <Ionicons name={paused ? 'play' : 'pause'} size={20} color={colors.foreground} />
            </Pressable>
          </View>
        </View>

        <View style={[styles.arena, { height: arenaHeight, backgroundColor: colors.arena }]} testID="game-arena">
          <View style={styles.arenaGrid} pointerEvents="none" />
          <View style={styles.arenaGlow} pointerEvents="none" />
          {STAR_POSITIONS.map((star, index) => (
            <View key={`arena-star-${index}`} pointerEvents="none" style={[styles.star, { left: star.left, top: star.top, backgroundColor: index % 2 ? colors.violet : colors.cyan }]} />
          ))}
          {enemies.map((enemy) => (
            <View
              key={enemy.id}
              style={[
                styles.enemy,
                {
                  left: enemy.x - enemy.radius,
                  top: enemy.y - enemy.radius,
                  width: enemy.radius * 2,
                  height: enemy.radius * 2,
                  borderRadius: enemy.radius,
                  backgroundColor: enemy.flashUntil > Date.now() ? colors.foreground : colors.shadow,
                  borderColor: enemy.color,
                  shadowColor: enemy.color,
                },
              ]}
            >
              <View style={[styles.enemyCore, { backgroundColor: enemy.color }]} />
              {enemy.type === 'boss' ? <Text style={styles.bossGlyph}>X</Text> : null}
              <View style={[styles.enemyHealthTrack, { width: enemy.radius * 2.1 }]}>
                <View style={[styles.enemyHealthFill, { width: `${clamp((enemy.hp / enemy.maxHp) * 100, 0, 100)}%`, backgroundColor: enemy.color }]} />
              </View>
            </View>
          ))}
          <View
            style={[
              styles.player,
              {
                left: player.x - 19,
                top: player.y - 19,
                backgroundColor: colors.shadow,
                borderColor: colors.cyan,
                opacity: player.invulnerableUntil > Date.now() ? 0.55 : 1,
              },
            ]}
          >
            <View style={[styles.playerEye, { backgroundColor: colors.cyan, left: 10 }]} />
            <View style={[styles.playerEye, { backgroundColor: colors.violet, right: 10 }]} />
            <View style={[styles.sword, { backgroundColor: colors.cyan, shadowColor: colors.cyan }]} />
          </View>
          {activeEffect ? (
            <View
              pointerEvents="none"
              style={[
                activeEffect.kind === 'blast' ? styles.blastEffect : styles.slashEffect,
                {
                  left: activeEffect.x - (activeEffect.kind === 'blast' ? 84 : 34),
                  top: activeEffect.y - (activeEffect.kind === 'blast' ? 84 : 34),
                  borderColor: activeEffect.kind === 'blast' ? colors.violet : colors.cyan,
                },
              ]}
            />
          ) : null}
          {damageNumbers.map((item) => (
            <Text key={item.id} pointerEvents="none" style={[styles.damageNumber, { left: item.x - 16, top: item.y - 12, color: item.color }]}>
              {item.color === colors.gold ? `+${item.value}` : `-${item.value}`}
            </Text>
          ))}
          <View style={styles.enemyCounter}>
            <Text style={styles.enemyCounterLabel}>THREATS REMAINING</Text>
            <Text style={[styles.enemyCounterValue, { color: colors.foreground }]}>{enemies.length.toString().padStart(2, '0')}</Text>
          </View>
          <View style={styles.joystickZone} {...joystickResponder.panHandlers}>
            <View style={[styles.joystickBase, { borderColor: colors.border, backgroundColor: colors.muted }]}>
              <View style={[styles.joystickKnob, { backgroundColor: colors.cyan, shadowColor: colors.cyan }]} />
            </View>
            <Text style={styles.controlHint}>MOVE</Text>
          </View>
          <View style={styles.actionCluster}>
            <ActionButton testID="attack-button" icon="sword-cross" label="STRIKE" onPress={performAttack} accent={colors.cyan} disabled={!isPlaying} />
            <View style={styles.actionRow}>
              <ActionButton testID="dash-button" icon="fast-forward" label={dashReady ? 'DASH' : 'WAIT'} onPress={performDash} accent={colors.violet} disabled={!isPlaying || !dashReady} />
              <ActionButton testID="blast-button" icon="flare" label={blastReady ? 'BLAST' : `${Math.ceil(player.energy)}%`} onPress={performBlast} accent={colors.gold} disabled={!isPlaying || !blastReady} />
            </View>
          </View>
          {flash ? <View pointerEvents="none" style={[styles.flashOverlay, { backgroundColor: colors.violet }]} /> : null}
          {paused ? (
            <View style={styles.overlay}>
              <Text style={styles.overlayKicker}>SYSTEM PAUSED</Text>
              <Text style={styles.overlayTitle}>The void waits.</Text>
              <Pressable testID="resume-button" onPress={() => setPaused(false)} style={[styles.primaryButton, { backgroundColor: colors.cyan }]}>
                <Ionicons name="play" size={18} color={colors.primaryForeground} />
                <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>RESUME</Text>
              </Pressable>
              <Pressable testID="quit-button" onPress={openMenu} style={styles.overlayLink}>
                <Text style={styles.overlayLinkText}>RETURN TO MENU</Text>
              </Pressable>
            </View>
          ) : null}
          {mode === 'complete' ? (
            <View style={styles.overlay}>
              <Text style={[styles.overlayKicker, { color: colors.success }]}>ARENA CLEARED</Text>
              <Text style={styles.overlayTitle}>LEVEL {level} COMPLETE</Text>
              <Text style={styles.overlayBody}>The shadows retreat. Your legend gets louder.</Text>
              <Pressable testID="next-level-button" onPress={() => startLevel(level + 1)} style={[styles.primaryButton, { backgroundColor: colors.cyan }]}>
                <Ionicons name="arrow-forward" size={18} color={colors.primaryForeground} />
                <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>NEXT LEVEL</Text>
              </Pressable>
              <Pressable testID="complete-menu-button" onPress={openMenu} style={styles.overlayLink}>
                <Text style={styles.overlayLinkText}>RETURN TO MENU</Text>
              </Pressable>
            </View>
          ) : null}
          {mode === 'dead' ? (
            <View style={styles.overlay}>
              <Text style={[styles.overlayKicker, { color: colors.destructive }]}>SIGNAL LOST</Text>
              <Text style={styles.overlayTitle}>YOU DIED</Text>
              <Text style={styles.overlayBody}>The arena keeps score. Enter again when you are ready.</Text>
              <Pressable testID="restart-button" onPress={() => startLevel(level)} style={[styles.primaryButton, { backgroundColor: colors.cyan }]}>
                <Ionicons name="refresh" size={18} color={colors.primaryForeground} />
                <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>RESTART</Text>
              </Pressable>
              <Pressable testID="dead-menu-button" onPress={openMenu} style={styles.overlayLink}>
                <Text style={styles.overlayLinkText}>MAIN MENU</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  starsLayer: { ...StyleSheet.absoluteFill },
  star: { position: 'absolute', borderRadius: 99, opacity: 0.7 },
  menuContent: { flex: 1, justifyContent: 'space-between', paddingHorizontal: 24 },
  logoLockup: { alignItems: 'center' },
  logoMark: { width: 42, height: 42, borderWidth: 1, transform: [{ rotate: '45deg' }], justifyContent: 'center', alignItems: 'center', marginBottom: 18 },
  logoEye: { position: 'absolute', width: 5, height: 5, borderRadius: 4, transform: [{ rotate: '-45deg' }] },
  logoText: { color: '#f3f6ff', fontSize: 34, fontFamily: 'Inter_700Bold', letterSpacing: 5 },
  logoSubline: { color: '#8c94b8', fontSize: 9, fontFamily: 'Inter_600SemiBold', letterSpacing: 2.3, marginTop: 8 },
  menuIntro: { alignItems: 'center', marginTop: 26 },
  menuKicker: { color: '#6fe8ff', fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 2, marginBottom: 16 },
  menuHeadline: { color: '#f3f6ff', fontSize: 26, lineHeight: 32, fontFamily: 'Inter_700Bold', textAlign: 'center', maxWidth: 330 },
  menuBody: { color: '#8c94b8', fontSize: 14, lineHeight: 21, fontFamily: 'Inter_400Regular', textAlign: 'center', maxWidth: 300, marginTop: 12 },
  menuActions: { gap: 12, width: '100%', maxWidth: 390, alignSelf: 'center' },
  primaryButton: { minHeight: 54, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 20 },
  primaryButtonText: { fontSize: 13, fontFamily: 'Inter_700Bold', letterSpacing: 1.4 },
  secondaryActionRow: { flexDirection: 'row', gap: 12 },
  secondaryButton: { flex: 1, minHeight: 50, borderRadius: 16, borderWidth: 1, borderColor: '#2b3155', backgroundColor: '#12152a', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  secondaryButtonText: { color: '#dce3ff', fontSize: 11, fontFamily: 'Inter_700Bold', letterSpacing: 1 },
  menuFooter: { borderTopWidth: 1, borderTopColor: '#2b3155', paddingTop: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statLabel: { color: '#8c94b8', fontSize: 9, fontFamily: 'Inter_700Bold', letterSpacing: 1.5 },
  statValue: { color: '#f3f6ff', fontSize: 16, fontFamily: 'Inter_700Bold', marginTop: 4 },
  coinPill: { borderRadius: 999, backgroundColor: '#191d34', paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 7 },
  coinText: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  pageHeader: { paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 14 },
  iconButton: { width: 40, height: 40, borderRadius: 12, borderWidth: 1, borderColor: '#2b3155', backgroundColor: '#12152a', alignItems: 'center', justifyContent: 'center' },
  eyebrow: { color: '#8c94b8', fontSize: 9, fontFamily: 'Inter_700Bold', letterSpacing: 1.8 },
  pageTitle: { color: '#f3f6ff', fontSize: 28, fontFamily: 'Inter_700Bold', marginTop: 3 },
  panelContent: { flex: 1, paddingHorizontal: 18, paddingTop: 28, gap: 12 },
  currencyBanner: { borderRadius: 16, borderWidth: 1, borderColor: '#2b3155', backgroundColor: '#171b35', paddingHorizontal: 18, paddingVertical: 15, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  currencyValue: { fontSize: 25, fontFamily: 'Inter_700Bold', marginTop: 3 },
  upgradeRow: { minHeight: 92, borderRadius: 16, borderWidth: 1, borderColor: '#2b3155', backgroundColor: '#12152a', padding: 13, flexDirection: 'row', alignItems: 'center', gap: 12 },
  upgradeIcon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  upgradeCopy: { flex: 1 },
  upgradeLabel: { color: '#f3f6ff', fontSize: 14, fontFamily: 'Inter_700Bold' },
  upgradeDetail: { color: '#8c94b8', fontSize: 11, lineHeight: 16, fontFamily: 'Inter_400Regular', marginTop: 3 },
  levelDots: { flexDirection: 'row', gap: 4, marginTop: 7 },
  levelDot: { width: 18, height: 3, borderRadius: 4 },
  buyButton: { minWidth: 58, height: 48, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 3 },
  buyPrice: { fontSize: 12, fontFamily: 'Inter_700Bold' },
  settingsCard: { borderRadius: 16, borderWidth: 1, borderColor: '#2b3155', backgroundColor: '#12152a', padding: 17, minHeight: 78, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14 },
  settingCopy: { flex: 1 },
  toggle: { width: 50, height: 30, borderRadius: 16, padding: 3, justifyContent: 'center' },
  toggleThumb: { width: 24, height: 24, borderRadius: 13 },
  gameShell: { flex: 1 },
  hud: { minHeight: 72, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#080914' },
  hudLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  hudBrand: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tinyMark: { width: 14, height: 14, borderWidth: 1, transform: [{ rotate: '45deg' }] },
  hudBrandText: { color: '#f3f6ff', fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 1.2 },
  barGroup: { flex: 1, maxWidth: 170, gap: 3 },
  barLabelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  barLabel: { color: '#8c94b8', fontSize: 7, fontFamily: 'Inter_700Bold', letterSpacing: 1 },
  barValue: { fontSize: 8, fontFamily: 'Inter_600SemiBold' },
  barTrack: { height: 5, borderRadius: 5, overflow: 'hidden', backgroundColor: '#191d34', marginBottom: 2 },
  barFill: { height: '100%', borderRadius: 5 },
  hudRight: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  levelChip: { alignItems: 'center', paddingHorizontal: 8 },
  chipLabel: { color: '#8c94b8', fontSize: 7, fontFamily: 'Inter_700Bold', letterSpacing: 1 },
  chipValue: { fontSize: 16, fontFamily: 'Inter_700Bold', marginTop: 1 },
  arena: { position: 'relative', overflow: 'hidden', flex: 1 },
  arenaGrid: { ...StyleSheet.absoluteFill, opacity: 0.38, borderWidth: 1, borderColor: '#1d2342', backgroundColor: 'transparent' },
  arenaGlow: { position: 'absolute', width: 320, height: 320, borderRadius: 200, left: '50%', top: '42%', marginLeft: -160, marginTop: -160, backgroundColor: '#13163a', opacity: 0.48 },
  enemy: { position: 'absolute', borderWidth: 1.5, shadowOpacity: 0.65, shadowRadius: 12, elevation: 6, alignItems: 'center', justifyContent: 'center' },
  enemyCore: { width: '34%', height: '34%', borderRadius: 99, opacity: 0.9 },
  bossGlyph: { position: 'absolute', color: '#f3f6ff', fontSize: 17, fontFamily: 'Inter_700Bold' },
  enemyHealthTrack: { position: 'absolute', top: -9, height: 3, backgroundColor: '#191d34', borderRadius: 4, overflow: 'hidden' },
  enemyHealthFill: { height: '100%' },
  player: { position: 'absolute', width: 38, height: 38, borderRadius: 20, borderWidth: 1.5, shadowOpacity: 0.9, shadowRadius: 18, elevation: 8, alignItems: 'center', justifyContent: 'center' },
  playerEye: { position: 'absolute', top: 13, width: 4, height: 4, borderRadius: 3 },
  sword: { position: 'absolute', width: 5, height: 27, right: -8, top: -7, transform: [{ rotate: '42deg' }], borderRadius: 5, shadowOpacity: 0.85, shadowRadius: 10 },
  slashEffect: { position: 'absolute', width: 68, height: 68, borderRadius: 40, borderWidth: 3, opacity: 0.8, transform: [{ rotate: '35deg' }] },
  blastEffect: { position: 'absolute', width: 168, height: 168, borderRadius: 100, borderWidth: 3, opacity: 0.72 },
  damageNumber: { position: 'absolute', fontSize: 14, fontFamily: 'Inter_700Bold', textShadowColor: '#03040b', textShadowRadius: 4 },
  enemyCounter: { position: 'absolute', top: 14, left: 14 },
  enemyCounterLabel: { color: '#8c94b8', fontSize: 8, fontFamily: 'Inter_700Bold', letterSpacing: 1.2 },
  enemyCounterValue: { fontSize: 20, fontFamily: 'Inter_700Bold', marginTop: 2 },
  joystickZone: { position: 'absolute', left: 18, bottom: 18, width: 126, height: 126, alignItems: 'center', justifyContent: 'center' },
  joystickBase: { width: 92, height: 92, borderRadius: 50, borderWidth: 1, backgroundColor: '#191d34', opacity: 0.88, alignItems: 'center', justifyContent: 'center' },
  joystickKnob: { width: 45, height: 45, borderRadius: 24, shadowOpacity: 0.85, shadowRadius: 14, elevation: 7 },
  controlHint: { position: 'absolute', bottom: -3, color: '#8c94b8', fontSize: 8, fontFamily: 'Inter_700Bold', letterSpacing: 2 },
  actionCluster: { position: 'absolute', right: 12, bottom: 18, alignItems: 'flex-end', gap: 8 },
  actionRow: { flexDirection: 'row', gap: 8 },
  actionButton: { width: 78, height: 62, borderRadius: 16, borderWidth: 1, backgroundColor: '#12152a', alignItems: 'center', justifyContent: 'center', gap: 2 },
  actionLabel: { fontSize: 8, fontFamily: 'Inter_700Bold', letterSpacing: 0.8 },
  flashOverlay: { ...StyleSheet.absoluteFill, opacity: 0.12 },
  overlay: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(8, 9, 20, 0.9)', alignItems: 'center', justifyContent: 'center', padding: 28 },
  overlayKicker: { color: '#6fe8ff', fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 2.2, marginBottom: 12 },
  overlayTitle: { color: '#f3f6ff', fontSize: 30, fontFamily: 'Inter_700Bold', textAlign: 'center' },
  overlayBody: { color: '#8c94b8', fontSize: 14, lineHeight: 20, fontFamily: 'Inter_400Regular', textAlign: 'center', maxWidth: 290, marginTop: 12, marginBottom: 22 },
  overlayLink: { padding: 16 },
  overlayLinkText: { color: '#8c94b8', fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 1.5 },
});