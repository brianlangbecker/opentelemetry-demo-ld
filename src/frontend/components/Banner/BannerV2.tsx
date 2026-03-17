// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

import { useLDClient } from 'launchdarkly-react-client-sdk';
import * as S from './Banner.styled';

const BannerV2 = () => {
  const ldClient = useLDClient();

  const handleCtaClick = () => {
    // Fires a conversion event for the experiment metric.
    // The event key 'banner-cta-clicked' must match the metric defined in the LD experiment.
    // Create the experiment in LD: Experiments → Create → metric event key = 'banner-cta-clicked'
    ldClient?.track('banner-cta-clicked');
    window.location.hash = '#hot-products';
  };

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
        <S.GoShoppingButton style={{ background: '#fff', color: '#667eea' }} onClick={handleCtaClick}>
          Explore Now
        </S.GoShoppingButton>
      </S.TextContainer>
    </S.Banner>
  );
};

export default BannerV2;
