// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

import { useState, useEffect } from 'react';
import * as S from './PlatformFlag.styled';

const PlatformFlag = () => {
  // Must use useState/useEffect — module-scope window.ENV read causes React #418 hydration
  // mismatch: server renders 'local' (no window), client renders actual platform value.
  const [platform, setPlatform] = useState('local');

  useEffect(() => {
    const { NEXT_PUBLIC_PLATFORM = 'local' } = window.ENV ?? {};
    setPlatform(NEXT_PUBLIC_PLATFORM);
  }, []);

  return (
    <S.Block>{platform}</S.Block>
  );
};

export default PlatformFlag;
