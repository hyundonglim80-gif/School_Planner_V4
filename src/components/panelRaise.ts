// src/components/panelRaise.ts
//
// 쓰는 칸을 맨 위로 올린 때(raisedAt). EntryPanelHost가 칸마다 넣고, SidePanelFrame이 읽어
// 값이 바뀌면 오른쪽 줄에 다시 서서 맨 위로 간다. 칸 넷(메모·기록·일정·학급)에 값을 일일이
// 넘기지 않으려고 context로 두고, 서로를 부르는 고리가 생기지 않게 따로 뺐다.
import { createContext } from 'react';

export const PanelRaiseContext = createContext<number | undefined>(undefined);
