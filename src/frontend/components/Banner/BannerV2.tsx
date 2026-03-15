// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

import Link from 'next/link';
import * as S from './Banner.styled';

const BannerV2 = () => {
  return (
    <S.Banner style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
      <S.ImageContainer>
        <S.BannerImg />
      </S.ImageContainer>
      <S.TextContainer>
        <S.Title style={{ color: '#fff' }}>🚀 Experience the New Telescope Collection</S.Title>
        <p style={{ color: '#fff', fontSize: '18px', marginBottom: '20px' }}>
          Discover our latest optical innovations with 50% better clarity
        </p>
        <Link href="#hot-products">
          <S.GoShoppingButton style={{ background: '#fff', color: '#667eea' }}>
            Explore Now
          </S.GoShoppingButton>
        </Link>
      </S.TextContainer>
    </S.Banner>
  );
};

export default BannerV2;
