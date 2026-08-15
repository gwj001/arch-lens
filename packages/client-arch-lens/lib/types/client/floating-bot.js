/**
 * Floating robot: a draggable shell-overlay button that opens the Arch Lens
 * study desk panel. The panel hosts the study units (concept tree, graphs,
 * catalog) and sends questions into a selected session through the core
 * conversation pipeline — no chat UI of its own.
 * @module @deepseek-ai/dsh-client-arch-lens/src/client/floating-bot
 */
import { createElement as h, useEffect, useRef, useState } from 'react';
import { ArchView } from "./arch-view.js";
import css from './floating-bot.module.css';
const POS_KEY = 'arch-lens-bot-pos';
const FAB_KEY = 'arch-lens-fab-pos';
/** The shell-overlay floating robot. */
export function FloatingBot(props) {
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState(null);
    const [fabPos, setFabPos] = useState(null);
    const [sessionId, setSessionId] = useState(null);
    const sessionList = props.useSessions(state => ({ ids: state.ids, current: state.current }));
    const dragRef = useRef(null);
    const fabDragRef = useRef(null);
    // Panel position: restore the saved spot, else top-right corner.
    useEffect(() => {
        if (pos !== null)
            return;
        let saved = null;
        try {
            const raw = window.localStorage.getItem(POS_KEY);
            if (raw !== null)
                saved = JSON.parse(raw);
        }
        catch { /* corrupted saved position is ignored */ }
        setPos(saved ?? { x: Math.max(16, window.innerWidth - 760), y: 72 });
    }, [pos]);
    useEffect(() => {
        if (pos !== null)
            window.localStorage.setItem(POS_KEY, JSON.stringify(pos));
    }, [pos]);
    // FAB position: saved spot, else bottom-right corner.
    useEffect(() => {
        if (fabPos !== null)
            return;
        let saved = null;
        try {
            const raw = window.localStorage.getItem(FAB_KEY);
            if (raw !== null)
                saved = JSON.parse(raw);
        }
        catch { /* corrupted saved position is ignored */ }
        setFabPos(saved ?? { x: Math.max(16, window.innerWidth - 92), y: Math.max(16, window.innerHeight - 96) });
    }, [fabPos]);
    useEffect(() => {
        if (fabPos !== null)
            window.localStorage.setItem(FAB_KEY, JSON.stringify(fabPos));
    }, [fabPos]);
    // Default target session: the currently selected one.
    useEffect(() => {
        if (sessionId === null && sessionList.current !== undefined)
            setSessionId(sessionList.current);
    }, [sessionList.current, sessionId]);
    const onBarDown = (event) => {
        if (pos === null)
            return;
        dragRef.current = { startX: event.clientX, startY: event.clientY, origX: pos.x, origY: pos.y };
    };
    const onFabDown = (event) => {
        if (fabPos === null)
            return;
        fabDragRef.current = { startX: event.clientX, startY: event.clientY, origX: fabPos.x, origY: fabPos.y, moved: false };
    };
    useEffect(() => {
        const move = (event) => {
            const drag = dragRef.current;
            if (drag !== null) {
                setPos({
                    x: Math.max(0, drag.origX + event.clientX - drag.startX),
                    y: Math.max(0, drag.origY + event.clientY - drag.startY),
                });
            }
            const fab = fabDragRef.current;
            if (fab !== null) {
                const dx = event.clientX - fab.startX;
                const dy = event.clientY - fab.startY;
                if (!fab.moved && Math.hypot(dx, dy) > 5)
                    fab.moved = true;
                if (fab.moved) {
                    setFabPos({
                        x: Math.max(0, fab.origX + dx),
                        y: Math.max(0, fab.origY + dy),
                    });
                }
            }
        };
        const up = () => {
            dragRef.current = null;
            fabDragRef.current = null;
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
        return () => {
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
        };
    }, []);
    return h('div', { className: css.root }, open && pos !== null
        ? h('div', { className: css.panel, style: { left: pos.x, top: pos.y } }, h('div', { className: css.bar, onMouseDown: onBarDown }, h('span', { className: css.title }, '🧭 架构学习台'), h('select', {
            className: css.session,
            value: sessionId ?? '',
            title: '讲解目标会话（回复渲染在所选会话的主对话中）',
            onClick: (event) => event.stopPropagation(),
            onChange: (event) => setSessionId(event.target.value === '' ? null : event.target.value),
        }, h('option', { value: '', disabled: true }, '选择会话…'), sessionList.ids.map(id => h('option', { key: id, value: id }, id))), h('button', { className: css.btn, onClick: () => setOpen(false) }, '✕')), h('div', { className: css.body }, h(ArchView, {
            archLens: props.archLens,
            config: props.config,
            sessionId,
            useSessions: props.useSessions,
            send: (text) => {
                if (sessionId === null)
                    return Promise.reject(new Error('未选择目标会话'));
                return props.send(sessionId, text);
            },
        })))
        : null, h('button', {
        className: css.fab,
        style: fabPos !== null ? { left: fabPos.x, top: fabPos.y } : undefined,
        title: '拖动移动；点击展开/收起架构学习台',
        onMouseDown: onFabDown,
        onClick: () => {
            // A real drag must not toggle the panel.
            if (fabDragRef.current?.moved === true) {
                fabDragRef.current = null;
                return;
            }
            setOpen(value => !value);
        },
    }, open ? '✕' : '🤖'));
}
//# sourceMappingURL=floating-bot.js.map